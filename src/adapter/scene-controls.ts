/** Silk's scene-control button (v14 `getSceneControlButtons` record shape). */

export interface SceneControlTool {
  name: string;
  order: number;
  title?: string;
  icon?: string;
  button?: boolean;
  visible?: boolean;
  onChange?: (event: Event, active: boolean) => void;
}

export type SceneControls = Record<string, { tools?: Record<string, SceneControlTool> }>;

export function addSilkSceneControl(
  controls: SceneControls,
  { isGM, run }: { isGM: boolean; run: (command: string) => Promise<unknown> },
): void {
  const notes = controls['notes'];
  if (!notes) return;
  const tools = (notes.tools ??= {});
  tools['silk'] = {
    name: 'silk',
    title: 'SILK.Commands.canvas.open',
    icon: 'fa-solid fa-diagram-project',
    order: Object.keys(tools).length,
    button: true,
    visible: isGM,
    onChange: () => void run('canvas.open').catch((error: unknown) => console.error(error)),
  };
}
