//! Project API handlers

use crate::api::directory_picker::select_directory;
use crate::contracts::*;
use crate::mock::global_store;
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    Json,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

const DEFAULT_WORKSPACE_NAME: &str = "tura_workspace";

// ============================================================================
// Project List & Current
// ============================================================================

pub async fn list_projects() -> Json<Vec<Project>> {
    Json(list_projects_with_default_workspace())
}

pub async fn get_current_project(
    headers: HeaderMap,
    Query(params): Query<ProjectDirectoryParams>,
) -> Json<CurrentProjectResponse> {
    Json(
        current_project_value(ProjectDirectoryParams {
            directory: params
                .directory
                .or_else(|| encoded_header(&headers, "x-opencode-directory")),
        })
        .await,
    )
}

pub async fn current_project_value(params: ProjectDirectoryParams) -> CurrentProjectResponse {
    let directory = params
        .directory
        .or_else(|| global_store().get_current_directory());

    let project = directory.map(|dir| {
        let path = PathBuf::from(&dir);
        upsert_workspace_project(path, None)
    });

    CurrentProjectResponse { project }
}

pub async fn create_named_workspace(
    Json(payload): Json<WorkspaceCreateRequest>,
) -> Result<Json<Project>, (StatusCode, String)> {
    create_named_workspace_value(payload).await.map(Json)
}

pub async fn create_named_workspace_value(
    payload: WorkspaceCreateRequest,
) -> Result<Project, (StatusCode, String)> {
    let name = sanitize_workspace_name(payload.name.as_deref().unwrap_or("New project"));
    let directory = default_workspaces_directory().join(&name);
    prepare_workspace_directory(&directory)?;
    Ok(upsert_workspace_project(directory, Some(name)))
}

pub async fn use_default_workspace() -> Result<Json<Project>, (StatusCode, String)> {
    use_default_workspace_value().await.map(Json)
}

pub async fn use_default_workspace_value() -> Result<Project, (StatusCode, String)> {
    let name = DEFAULT_WORKSPACE_NAME.to_string();
    let directory = default_workspaces_directory().join(&name);
    prepare_workspace_directory(&directory)?;
    Ok(upsert_workspace_project(directory, Some(name)))
}

pub async fn select_local_workspace(
    Json(payload): Json<DirectoryWorkspaceRequest>,
) -> Result<Json<Option<Project>>, (StatusCode, String)> {
    select_local_workspace_value(payload).await.map(Json)
}

pub async fn select_local_workspace_value(
    payload: DirectoryWorkspaceRequest,
) -> Result<Option<Project>, (StatusCode, String)> {
    let title = payload.title.clone();
    let selected = tokio::task::spawn_blocking(move || select_directory(title.as_deref()))
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Directory picker task failed: {error}"),
            )
        })?
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open directory picker: {error}"),
            )
        })?;
    Ok(selected.map(|directory| {
        let path = PathBuf::from(directory);
        let name = workspace_name_from_path(&path);
        if let Err(error) = prepare_workspace_directory(&path) {
            tracing::warn!(
                directory = %path.display(),
                error = ?error,
                "failed to prepare selected workspace directory"
            );
        }
        upsert_workspace_project(path, Some(name))
    }))
}

fn same_directory(left: &str, right: &str) -> bool {
    left.replace('\\', "/")
        .trim_end_matches('/')
        .eq_ignore_ascii_case(right.replace('\\', "/").trim_end_matches('/'))
}

fn upsert_workspace_project(directory: PathBuf, name: Option<String>) -> Project {
    if let Err(error) = prepare_workspace_directory(&directory) {
        tracing::warn!(
            directory = %directory.display(),
            error = ?error,
            "failed to ensure project workspace directory"
        );
    }
    let worktree = directory.to_string_lossy().to_string();
    global_store().set_current_directory(worktree.clone());
    global_store()
        .list_projects()
        .into_iter()
        .find(|project| same_directory(&project.worktree, &worktree))
        .unwrap_or_else(|| global_store().add_project(worktree, name))
}

fn list_projects_with_default_workspace() -> Vec<Project> {
    let default_directory = default_workspaces_directory().join(DEFAULT_WORKSPACE_NAME);
    let default_worktree = default_directory.to_string_lossy().to_string();
    let mut projects = global_store().list_projects();
    if !projects
        .iter()
        .any(|project| same_directory(&project.worktree, &default_worktree))
    {
        let _ = prepare_workspace_directory(&default_directory);
        projects.insert(
            0,
            global_store().add_project(default_worktree, Some(DEFAULT_WORKSPACE_NAME.to_string())),
        );
    }
    projects
}

fn prepare_workspace_directory(directory: &Path) -> Result<(), (StatusCode, String)> {
    fs::create_dir_all(directory).map_err(internal_error)?;
    runtime::workspace_git::ensure_workspace_git_repo(directory).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to prepare workspace git repository: {error}"),
        )
    })
}

fn default_workspaces_directory() -> PathBuf {
    tura_path::instance_home().join("workspaces")
}

fn sanitize_workspace_name(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .to_string();
    if sanitized.is_empty() {
        "New project".to_string()
    } else {
        sanitized
    }
}

fn workspace_name_from_path(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(sanitize_workspace_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn internal_error(error: std::io::Error) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Failed to prepare workspace directory: {error}"),
    )
}

fn encoded_header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        output.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&output).into_owned()
}

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_directory_matches_mixed_separators_and_case() {
        assert!(same_directory(
            r"C:\Users\Alice\Documents\tura_workspace\",
            "c:/users/alice/documents/tura_workspace"
        ));
    }
}
