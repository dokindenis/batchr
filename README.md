# Batchr

Figma plugin for batch icon production: renaming and sprite creation.

## Features

### Batch Renaming

- Works with **main components** and **frames** (frames are auto-converted to components on apply).
- Selection must be in groups of 4 matching one of the size sets:
  - Regular: `20/25/30/35` or `24/30/36/42`
  - Big: `28/35/42/49`
  - Huge: `40/50/60/70`
- Generates names for 4 scales: `1x`, `1.25x`, `1.5x`, `1.75x`.
- Role in the name is taken from the current Figma page name.
- Optional underscore prefix (`_`) to exclude from publishing.
- Optional generation of `@2x` and `SVG` components.

### Sprite Creation

- Works with selected **instances**.
- Auto-detects the variable collection and Dark mode from the selected elements (supports both local and library collections).
- Wraps each instance into an auto-layout frame with the detected theme applied.

## Installation (Development)

1. Open Figma.
2. Go to `Plugins -> Development -> Import plugin from manifest...`
3. Select `manifest.json`.

## Usage

### Renaming

1. Select icon **components** or **frames** in groups of 4.
2. The plugin validates sizes and shows the detected size set and row count.
3. Toggle options as needed:
   - **Create @2x and SVG components**
   - **Exclude from publishing** (underscore prefix)
4. Preview names, then click **Apply**.

### Sprites

1. Select one or more icon **instances**.
2. The plugin auto-detects the variable collection and dark mode.
3. Click **Create**.

## Notes

- Renaming requires selection count divisible by 4.
- Sprite creation requires all selected elements to be instances.
- After sprite creation, the selection is cleared automatically.
