/**
 * Garn's scene-control button (v14 `getSceneControlButtons` record shape). One button for
 * everyone: `canvas.open` opens the World Canvas for a GM, the Player Canvas for a player (§9).
 */

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

export function addGarnSceneControl(
  controls: SceneControls,
  { run }: { run: (command: string) => Promise<unknown> },
): void {
  const notes = controls['notes'];
  if (!notes) return;
  const tools = (notes.tools ??= {});
  tools['garn'] = {
    name: 'garn',
    title: 'GARN.Commands.canvas.open',
    icon: 'fa-solid fa-diagram-project',
    order: Object.keys(tools).length,
    button: true,
    visible: true,
    onChange: () => void run('canvas.open').catch((error: unknown) => console.error(error)),
  };
}
