/**
 * Tests for the SetupScreen component.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SetupScreen from "./SetupScreen.svelte";

describe("SetupScreen component", () => {
  it("renders heading with 'Setting up CodeHydra' text", () => {
    render(SetupScreen);

    expect(screen.getByRole("heading", { name: /setting up codehydra/i })).toBeInTheDocument();
  });

  it("renders Logo with animation", () => {
    const { container } = render(SetupScreen);

    const logo = container.querySelector("img");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveClass("animated");
  });

  it("displays static first-startup message", () => {
    render(SetupScreen);

    expect(screen.getByText("This is only required on first startup.")).toBeInTheDocument();
  });

  it("renders without props (no props required)", () => {
    // Should render successfully without any props
    const { container } = render(SetupScreen);
    expect(container.querySelector(".setup-screen")).toBeInTheDocument();
  });

  describe("accessibility", () => {
    it("renders vscode-progress-bar component", () => {
      const { container } = render(SetupScreen);

      // Web components are queried by tag name since shadow DOM isn't accessible in JSDOM
      const progressBar = container.querySelector("vscode-progress-bar");
      expect(progressBar).toBeInTheDocument();
    });

    it("has indeterminate property set on progress bar", () => {
      const { container } = render(SetupScreen);

      const progressBar = container.querySelector("vscode-progress-bar") as HTMLElement & {
        indeterminate?: boolean;
      };
      // Svelte sets boolean props as JavaScript properties on web components
      expect(progressBar?.indeterminate).toBe(true);
    });

    it("has aria-label for screen readers", () => {
      const { container } = render(SetupScreen);

      const progressBar = container.querySelector("vscode-progress-bar");
      expect(progressBar).toHaveAttribute("aria-label", "Setting up CodeHydra");
    });

    it("has aria-live on step message for screen reader announcements on mount", () => {
      render(SetupScreen);

      const stepMessage = screen.getByText("This is only required on first startup.");
      expect(stepMessage).toHaveAttribute("aria-live", "polite");
    });
  });
});
