# Batchr

Batchr is a Figma plugin for batch icon production:
- Rename icon **main components** in scale groups.
- Create sprite-ready components from selected **instances**.

## Features

- Batch rename for component sets (`1x`, `1.25x`, `1.5x`, `1.75x`).
- Role-based naming (`common`, `documenteditor`, `spreadsheeteditor`, etc.).
- Optional underscore prefix (`_`).
- Optional generation of `@2x` and `SVG` components.
- Sprite creation flow for any number of selected instances.
- Fast validation UI states (awaiting, loading, ready, error, sprites-ready).

## Requirements

- Figma editor
- Local variable collection named `icons` with mode `Dark` (required for sprite creation)

## Installation (Development)

1. Open Figma.
2. Go to `Plugins -> Development -> Import plugin from manifest...`
3. Select `manifest.json`

## Usage

### 1) Batch Renaming (main components)

1. Select icon **main components** in groups of 4.
2. Make sure the selection follows expected size sets.
3. Configure:
   - Prefix (`_`)
   - Icon role
   - Optional `@2x + SVG`
4. Click **Apply**.

### 2) Sprite Creation (instances)

1. Select one or more icon **instances**.
2. Plugin shows `Will create X sprites`.
3. Click **Create**.

## Notes

- Renaming works only with **main components** and selection count divisible by 4.
- Sprite creation works only with **instances**.
- After sprite creation, selection is cleared automatically.
