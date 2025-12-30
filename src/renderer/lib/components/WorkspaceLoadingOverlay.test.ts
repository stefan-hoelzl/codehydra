/**
 * Tests for WorkspaceLoadingOverlay component.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import WorkspaceLoadingOverlay from "./WorkspaceLoadingOverlay.svelte";

describe("WorkspaceLoadingOverlay", () => {
  describe("rendering", () => {
    it("renders loading message", () => {
      render(WorkspaceLoadingOverlay);

      expect(screen.getByText("Loading workspace...")).toBeInTheDocument();
    });

    it("renders progress ring", () => {
      const { container } = render(WorkspaceLoadingOverlay);

      const progressRing = container.querySelector("vscode-progress-ring");
      expect(progressRing).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it('has role="status" for screen readers', () => {
      const { container } = render(WorkspaceLoadingOverlay);

      const overlay = container.querySelector('[role="status"]');
      expect(overlay).toBeInTheDocument();
    });

    it('has aria-live="polite" for screen reader announcements', () => {
      const { container } = render(WorkspaceLoadingOverlay);

      const overlay = container.querySelector('[aria-live="polite"]');
      expect(overlay).toBeInTheDocument();
    });
  });

  describe("styling", () => {
    it("applies overlay positioning", () => {
      const { container } = render(WorkspaceLoadingOverlay);

      const overlay = container.querySelector(".loading-overlay");
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveClass("loading-overlay");
    });
  });
});
