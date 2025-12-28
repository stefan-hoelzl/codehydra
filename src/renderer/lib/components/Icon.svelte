<script lang="ts">
  interface IconProps {
    /** Codicon name (e.g., "check", "warning", "close") */
    name: string;
    /** Icon size in pixels (default 16, matches vscode-icon default) */
    size?: number;
    /** Accessibility label - makes icon semantic (announced by screen readers) */
    label?: string;
    /** Makes icon behave like a button with hover/focus states */
    action?: boolean;
    /** Enables rotation animation */
    spin?: boolean;
    /** Additional CSS classes */
    class?: string;
  }

  let {
    name,
    size = 16,
    label,
    action = false,
    spin = false,
    class: className = "",
  }: IconProps = $props();

  // Decorative icons (no label) should be hidden from screen readers
  // Action icons with labels are semantic and should be announced
  const isDecorative = $derived(!label);
</script>

<vscode-icon
  {name}
  {size}
  {spin}
  action-icon={action || undefined}
  label={action ? label : undefined}
  class={className}
  aria-hidden={isDecorative ? "true" : undefined}
></vscode-icon>
