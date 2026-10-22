# **Dungeon RPG Programming Skills: Architecture & Modular Development Guide**

# **1\. Overview and Development Workflow**

Building scalable, browser-based 3D action RPGs using Three.js and modern Web APIs requires strict architectural boundaries. Unstructured web game code often suffers from rapid technical debt, scope creep, and severe regression risks when introducing new levels or entity behaviors.

This technical guide outlines a robust, modular framework designed for AI-assisted engineering environments. It establishes a repeatable iteration loop using Cursor (IDE) and Gemini (Architect review) to systematically refactor, maintain, and expand a Three.js RPG codebase.

## **Iterative Feedback Loop**

┌────────────────┐     Generates Code     ┌────────────────┐

│   Cursor IDE   │ ─────────────────────\> │ Web RPG Code   │

│  (AI Editor)   │                        │ (Three.js/npm) │

└────────────────┘                        └───────┬────────┘

        ▲                                         │

        │ Structured Prompts                      │ Gameplay Testing &

        │                                         │ Screenshot/Video Capture

        │                                         ▼

┌───────┴────────┐     Reviews & Designs   ┌────────────────┐

│   Gemini AI    │ \<───────────────────── │ Visual/Console │

│  (Architect)   │     Technical Prompts  │ Technical Audit│

└────────────────┘                        └────────────────┘

1. **Generation**: Prompt Cursor to generate or refactor Three.js and npm-based web components based on concrete specifications.  
2. **Runtime Verification**: Run the web app, test interactions, measure rendering performance, and capture visually rich screenshots or video traces of edge cases and defects.  
3. **Architectural Review**: Feed runtime artifacts, memory snapshots, and code samples into Gemini to diagnose systemic issues, memory leaks, or improper coupling.  
4. **Prompt Refinement**: Receive precisely scoped, highly targeted refactoring prompts from Gemini and apply them back in Cursor.

## **Strategic Objectives**

* **Zero-Regression Content Delivery**: Add entire game zones, NPCs, and mechanics without altering stable core engine code.  
* **Engine-Content Decoupling**: Isolate rendering pipelines, global loop controls, and input listeners from scene-specific level logic.  
* **Component-Oriented OOP Architecture**: Standardize entity interfaces, combat interactions, and physics handlers into predictable, extensible classes.

---

# **2\. Architectural Strategy: Decoupling Engine Core from Area Data**

To scale a dungeon RPG beyond a single monolithic prototype file, code must be divided strictly between engine operations, system logic, and data-driven area definitions.

## **Project Directory Structure**

src/

├── core/                  \# Immutable Engine Core Systems

│   ├── Engine.js          \# Master initialization & loop controller

│   ├── SceneManager.js    \# Scene graph operations & transitions

│   ├── InputHandler.js   \# Hardware input normalization

│   └── AssetLoader.js    \# Cache-enabled mesh, texture & sound loader

├── entities/              \# Object-Oriented Game Objects

│   ├── BaseEntity.js      \# Base class for all world objects

│   ├── Player.js          \# Player state & camera attachment

│   ├── FirstPersonController.js \# FPS camera & movement physics

│   ├── Enemy.js           \# AI state machine & combat receiver

│   ├── NPC.js             \# Dialogue triggers & interaction handlers

│   └── InteractiveObject.js \# Doors, chests, levers, traps

├── systems/               \# Reusable Global Game Mechanics

│   ├── CombatSystem.js    \# Damage calculation, hitboxes, stats

│   ├── InventorySystem.js \# Item storage, equipment, drop tables

│   └── PhysicsCollision.js\# Raycasting, BVH, bounding volume checks

├── areas/                 \# Level & Zone Content (Extensible)

│   ├── AreaBase.js        \# Abstract contract for all level modules

│   ├── Area1.js           \# Initial prototype level

│   ├── TownArea.js        \# Safe hub zone definition

│   └── ForestArea.js      \# Outdoor dynamic zone definition

└── config/                \# Pure Configuration Data

    ├── StatsConfig.js     \# Character base attributes & formulas

    ├── ItemDatabase.js    \# Static item metadata

    └── SpawnTables.js     \# Entity spawn rates per area

## **Architectural Guardrails**

* **Immutable Engine Core**: Files inside `src/core/` are treated as read-only runtime primitives during level and content development.  
* **Data-Driven Level Design**: Area files (`src/areas/`) define triggers, ambient configurations, static mesh compositions, and entity spawn lists. Mechanics are never implemented inside area files directly; they invoke existing systems.  
* **Lifecycle Contract**: Every environment module extending `AreaBase.js` must implement the strict runtime lifecycle.

| Lifecycle Method | Execution Phase | Responsibilities |
| :---- | :---- | :---- |
| `init()` | Pre-instantiation | Allocates memory for internal area states and local event listeners. |
| `load(scene, assetLoader)` | Async Initialization | Fetches model files, instantiates Three.js meshes, populates light maps, and attaches entities to the scene graph. |
| `update(delta)` | Per-Frame Loop | Executes local dynamic behaviors, updates active particle emitters, and checks local triggers. |
| `unload(scene)` | Pre-destruction | Detaches meshes from the scene, unsubscribes local events, and releases local audio streams. |
| `destroy()` | Disposal Phase | Disposes geometries, materials, textures, and nullifies references for garbage collection. |

## **Resource Cleanup & Memory Safety Rules**

To prevent heap allocation creep and WebGL context losses during area transitions:t  
// Strict Three.js Object Disposal Pattern  
disposeHierarchy(node) {  
if (\!node) return;

if (node.children) {  
while (node.children.length \> 0\) {  
this.disposeHierarchy(node.children\[0\]);  
node.remove(node.children\[0\]);  
}  
}

if (node.geometry) {  
node.geometry.dispose();  
}

if (node.material) {  
if (Array.isArray(node.material)) {  
node.material.forEach(mat \=\> this.disposeMaterial(mat));  
} else {  
this.disposeMaterial(node.material);  
}  
}  
}

disposeMaterial(material) {  
Object.keys(material).forEach(key \=\> {  
const value \= material\[key\];  
if (value && typeof value \=== 'object' && typeof value.dispose \=== 'function') {  
value.dispose();  
}  
});  
material.dispose();  
}

\---

\#\# 3\. Cursor Rules Configuration (\`.cursor/rules\`)

To enforce architectural conventions when using AI agents for generation, create \`.cursor/rules/game-architecture.mdc\`.

\`\`\`markdown

\---

description: RPG Engine Architecture Constraints and Coding Standards

globs: src/\*\*/\*.js

\---

\# RPG Architecture & Engineering Rules

\#\# 1\. Modularity Principles

\- NEVER write monolithic procedural code inside main entry files.

\- ALWAYS extend abstract base classes (\`AreaBase\`, \`BaseEntity\`) when creating new modules.

\- Ensure total separation between rendering (\`Three.js\`), dynamic physics, and entity state data.

\#\# 2\. Core Immutability

\- Files within \`src/core/\` are IMMUTABLE unless explicitly instructed to perform engine-level upgrades.

\- New level features MUST be built entirely inside \`src/areas/\` or \`src/entities/\`.

\- Do not add direct references to specific levels inside \`Engine.js\` or \`SceneManager.js\`.

\#\# 3\. Memory & Resource Management

\- Every component allocating Three.js resources (\`Mesh\`, \`Geometry\`, \`Material\`, \`Texture\`) MUST implement explicit disposal in its \`destroy()\` or \`unload()\` hook.

\- Event listeners added in \`init()\` or \`load()\` MUST be explicitly removed in \`unload()\`.

\#\# 4\. Verification Standards

\- Code must pass \`npm run build\` without missing dynamic imports or syntax warnings.

\- Class signatures must match inherited interfaces exactly.

---

# **4\. Cursor Prompts for Incremental Refactoring**

Use these structural prompts sequentially to refactor legacy Three.js prototypes into a production-grade modular engine.

## **Phase 1: Audit & Architectural Planning**

Act as a Lead Graphics & Game Engine Architect. Analyze our existing Three.js single-file code base.

Task:

1\. Identify all implicit global variables, coupled rendering functions, input listeners, and inline level definitions.

2\. Outline a detailed refactoring plan to split the code into \`src/core/\`, \`src/entities/\`, \`src/systems/\`, and \`src/areas/\`.

3\. Design the abstract \`AreaBase.js\` interface incorporating strict lifecycle methods: \`init()\`, \`load(scene, assetLoader)\`, \`update(delta)\`, \`unload(scene)\`, and \`destroy()\`.

Constraints:

\- DO NOT generate modified code yet.

\- Provide a strict audit report outlining existing code coupling and memory leak risks.

## **Phase 2: Core Subsystem Extraction**

t  
Act as a Senior Web Game Systems Engineer. We are beginning Phase 2 of our architectural refactoring.

Task:

1. Extract the low-level rendering loop, window resize listeners, and WebGL renderer initialization into `src/core/Engine.js`.  
2. Extract the First-Person perspective camera controller, movement physics, and PointerLock API handlers into `src/entities/FirstPersonController.js` and `src/entities/Player.js`.  
3. Ensure `Engine.js` accepts a dynamic `Area` object and manages its lifecycle through `load()`, `update()`, and `unload()`.

Constraints:

* Preserve all existing movement physics and camera sensitivity parameters.  
* Ensure `npm run dev` launches the engine successfully with the decoupled core.

\#\#\# Phase 3: Area Base Blueprint & First Level Migration

\`\`\`text

Act as a Game Framework Engineer. We are implementing the Area modularity layer.

Task:

1\. Create \`src/areas/AreaBase.js\` enforcing explicit lifecycle hooks (\`init\`, \`load\`, \`update\`, \`unload\`, \`destroy\`).

2\. Implement robust Three.js asset disposal functions within \`AreaBase\` to clear geometries, materials, and textures recursively.

3\. Migrate our original map geometry, lighting setups, and enemy spawn locations out of global scope into \`src/areas/Area1.js\` extending \`AreaBase.js\`.

Constraints:

\- Verify that swapping or re-loading \`Area1\` disposes all GPU memory without throwing WebGL errors.

---

# **5\. Adding New Areas & Feature Extension**

To introduce new environments (e.g., a Forest Zone) without altering engine code, pass the following structured generation prompt to Cursor.

## **Area Extension Prompt (`ForestArea.js`)**

Act as a Game Content Engineer. Create a new level module \`src/areas/ForestArea.js\`.

Requirements:

1\. Extend \`AreaBase\` and implement all inherited lifecycle hooks.

2\. Environment Design:

   \- Add ambient directional light with a soft green/gold hue (\`0xb5d8a0\`).

   \- Create dynamic ground terrain using \`THREE.PlaneGeometry\` with displaced vertex heightmaps.

   \- Instanciate static tree models and rocks using instanced meshes (\`THREE.InstancedMesh\`) for optimal performance.

3\. Spawns & Systems Integration:

   \- Read spawn configurations from \`src/config/SpawnTables.js\`.

   \- Instantiate 5 \`Enemy\` entities using the existing \`src/entities/Enemy.js\` class.

   \- Integrate existing \`PhysicsCollision\` system to handle player-tree colliders.

Constraints:

\- DO NOT modify any code in \`src/core/\` or \`src/systems/\`.

\- Ensure clean mesh and texture cleanup inside \`unload(scene)\`.

---

# **6\. Testing, Verification, and Regression Prevention**

A modular architecture allows for automated integration testing and systematic verification across environment lifecycles.

## **Automated Test Integration (Vitest / Jest)**

Create tests to verify that lifecycle methods maintain system integrity during transitions:t  
// tests/areaLifecycle.test.js  
import { describe, it, expect, beforeEach, vi } from 'vitest';  
import { Engine } from '../src/core/Engine.js';  
import { ForestArea } from '../src/areas/ForestArea.js';

describe('Area Lifecycle Management', () \=\> {  
let mockScene, mockAssetLoader, area;

beforeEach(() \=\> {  
mockScene \= { add: vi.fn(), remove: vi.fn() };  
mockAssetLoader \= { loadModel: vi.fn().mockResolvedValue({}) };  
area \= new ForestArea();  
});

it('should initialize without throw', () \=\> {  
expect(() \=\> area.init()).not.toThrow();  
});

it('should populate scene graph upon load', async () \=\> {  
area.init();  
await area.load(mockScene, mockAssetLoader);  
expect(mockScene.add).toHaveBeenCalled();  
});

it('should properly clear elements upon unload and destroy', async () \=\> {  
area.init();  
await area.load(mockScene, mockAssetLoader);const disposeSpy \= vi.spyOn(area, 'destroy');

area.unload(mockScene);

area.destroy();

expect(mockScene.remove).toHaveBeenCalled();

expect(disposeSpy).toHaveBeenCalled();

});  
});

\#\#\# Architectural Verification Checklist

Use this checklist before merging any refactored module or newly generated game area into the main branch:

\[ \] Core Integrity Check  
\[ \] Core files in `src/core/` remain untouched (`git status src/core/` shows no diffs).  
\[ \] The global engine loop runs at steady FPS without hitching.

\[ \] Interface Compliance  
\[ \] Target Area extends `AreaBase.js`.  
\[ \] All 5 lifecycle hooks (`init`, `load`, `update`, `unload`, `destroy`) are defined.  
\[ \] Method signatures align perfectly with parent abstract definitions.

\[ \] Memory & Resource Disposal  
\[ \] Disposed geometries and materials explicitly call `.dispose()`.  
\[ \] Textures bound to materials are detached and disposed.  
\[ \] All event listeners attached to `window` or `document` are removed in `unload()`.

\[ \] Build & Runtime Stability  
\[ \] Project compiles cleanly via `npm run build`.  
\[ \] Switching areas rapidly in sequence does not increase WebGL render calls or memory baseline.