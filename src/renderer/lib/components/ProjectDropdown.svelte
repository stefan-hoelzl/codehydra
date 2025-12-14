<script lang="ts">
  import FilterableDropdown, { type DropdownOption } from "./FilterableDropdown.svelte";
  import { projects } from "$lib/stores/projects.svelte.js";

  interface ProjectDropdownProps {
    value: string;
    onSelect: (projectPath: string) => void;
    disabled?: boolean;
  }

  let { value, onSelect, disabled = false }: ProjectDropdownProps = $props();

  /**
   * Transform projects to DropdownOption[].
   * All projects are selectable options (no headers).
   */
  const dropdownOptions = $derived.by((): DropdownOption[] => {
    return projects.value.map((project) => ({
      type: "option" as const,
      label: project.name,
      value: project.path,
    }));
  });

  /**
   * Get the display value (project name) from the project path.
   */
  const displayValue = $derived.by(() => {
    const project = projects.value.find((p) => p.path === value);
    return project?.name ?? "";
  });

  /**
   * Filter function for projects - matches by name.
   */
  function filterProject(option: DropdownOption, filterLowercase: string): boolean {
    return option.label.toLowerCase().includes(filterLowercase);
  }
</script>

<div class="project-dropdown">
  <FilterableDropdown
    options={dropdownOptions}
    value={displayValue}
    {onSelect}
    {disabled}
    placeholder="Select project..."
    filterOption={filterProject}
    id="project-dropdown"
  />
</div>

<style>
  .project-dropdown {
    width: 100%;
  }
</style>
