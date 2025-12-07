<script lang="ts">
  import * as api from "$lib/api";
  import {
    projects,
    activeWorkspacePath,
    loadingState,
    loadingError,
    setProjects,
    addProject,
    removeProject,
    setActiveWorkspace,
    setLoaded,
    setError,
    addWorkspace,
    removeWorkspace,
  } from "$lib/stores/projects.svelte.js";
  import { dialogState, openCreateDialog, openRemoveDialog } from "$lib/stores/dialogs.svelte.js";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import CreateWorkspaceDialog from "$lib/components/CreateWorkspaceDialog.svelte";
  import RemoveWorkspaceDialog from "$lib/components/RemoveWorkspaceDialog.svelte";
  import type { ProjectPath } from "$lib/api";

  // Shortcut mode state for keyboard navigation
  let shortcutModeActive = $state(false);

  // Sync dialog state with main process z-order
  $effect(() => {
    const isDialogOpen = dialogState.value.type !== "closed";
    void api.setDialogMode(isDialogOpen);
  });

  // Subscribe to shortcut enable events from main process
  $effect(() => {
    const unsubscribe = api.onShortcutEnable(() => {
      shortcutModeActive = true;
      console.log("KEYBOARD_WIRING: shortcut mode enabled");
    });
    return unsubscribe;
  });

  // Subscribe to shortcut disable events from main process (handles race condition)
  $effect(() => {
    const unsubscribe = api.onShortcutDisable(() => {
      deactivateShortcutMode("main-process-disable");
    });
    return unsubscribe;
  });

  /**
   * Deactivates shortcut mode and returns focus to workspace.
   * Used by both keyup and blur handlers for consistent cleanup.
   */
  function deactivateShortcutMode(reason: string): void {
    if (!shortcutModeActive) return;
    shortcutModeActive = false;
    console.log(`KEYBOARD_WIRING: shortcut mode disabled (${reason})`);
    // Fire-and-forget pattern - see AGENTS.md IPC Patterns
    void api.setDialogMode(false);
    void api.focusActiveWorkspace();
  }

  function handleKeyUp(event: KeyboardEvent): void {
    // Ignore auto-repeat events at UI layer as well
    if (event.repeat) return;
    if (event.key === "Alt" && shortcutModeActive) {
      deactivateShortcutMode("alt-release");
    }
  }

  function handleWindowBlur(): void {
    deactivateShortcutMode("blur");
  }

  // Set up initialization and event subscriptions on mount
  $effect(() => {
    // Track all subscriptions for cleanup
    const subscriptions: (() => void)[] = [];

    // Initialize - load projects
    api
      .listProjects()
      .then((p) => {
        setProjects(p);
        setLoaded();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      });

    // Subscribe to events
    subscriptions.push(
      api.onProjectOpened((event) => {
        addProject(event.project);
      })
    );

    subscriptions.push(
      api.onProjectClosed((event) => {
        removeProject(event.path);
      })
    );

    subscriptions.push(
      api.onWorkspaceCreated((event) => {
        addWorkspace(event.projectPath, event.workspace);
      })
    );

    subscriptions.push(
      api.onWorkspaceRemoved((event) => {
        removeWorkspace(event.projectPath, event.workspacePath);
      })
    );

    subscriptions.push(
      api.onWorkspaceSwitched((event) => {
        setActiveWorkspace(event.workspacePath);
      })
    );

    // Cleanup all subscriptions on unmount
    return () => {
      subscriptions.forEach((unsub) => unsub());
    };
  });

  // Handle opening a project
  async function handleOpenProject(): Promise<void> {
    const path = await api.selectFolder();
    if (path) {
      await api.openProject(path);
    }
  }

  // Handle closing a project
  async function handleCloseProject(path: ProjectPath): Promise<void> {
    await api.closeProject(path);
  }

  // Handle switching workspace
  async function handleSwitchWorkspace(workspacePath: string): Promise<void> {
    await api.switchWorkspace(workspacePath);
  }

  // Handle opening create dialog
  function handleOpenCreateDialog(projectPath: string, triggerId: string): void {
    openCreateDialog(projectPath, triggerId);
  }

  // Handle opening remove dialog
  function handleOpenRemoveDialog(workspacePath: string, triggerId: string): void {
    openRemoveDialog(workspacePath, triggerId);
  }
</script>

<svelte:window onkeyup={handleKeyUp} onblur={handleWindowBlur} />

<main class="app">
  <Sidebar
    projects={projects.value}
    activeWorkspacePath={activeWorkspacePath.value}
    loadingState={loadingState.value}
    loadingError={loadingError.value}
    onOpenProject={handleOpenProject}
    onCloseProject={handleCloseProject}
    onSwitchWorkspace={handleSwitchWorkspace}
    onOpenCreateDialog={handleOpenCreateDialog}
    onOpenRemoveDialog={handleOpenRemoveDialog}
  />
</main>

{#if dialogState.value.type === "create"}
  <CreateWorkspaceDialog open={true} projectPath={dialogState.value.projectPath} />
{:else if dialogState.value.type === "remove"}
  <RemoveWorkspaceDialog open={true} workspacePath={dialogState.value.workspacePath} />
{/if}

<style>
  .app {
    display: flex;
    height: 100vh;
    color: var(--ch-foreground);
    /* TODO: Transparency between WebContentsViews not working on Linux.
       Investigate in KEYBOARD_ACTIVATION plan. For now, use opaque background. */
    background: var(--ch-background);
  }
</style>
