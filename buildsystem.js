// buildSystem.js - Performance-Optimized 3D Voxel Building Module
import * as THREE from 'three';

export class BuildSystem {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.worldManager = null;

        // --- Configuration ---
        this.BLOCK_SIZE = 1.0;
        this.MAX_BLOCKS_PER_TYPE = 750;
        this.NUM_TYPES = 8;

        this.BLOCK_TYPES = [
            { id: 0, name: 'Stone 01', color: '#eeeeee' },
            { id: 1, name: 'Stone 02', color: '#7a6b5a' },
            { id: 2, name: 'Stone 03', color: '#8d6e63' },
            { id: 3, name: 'Stone 04', color: '#4e342e' },
            { id: 4, name: 'Stone 05', color: '#37474f' },
            { id: 5, name: 'Stone 06', color: '#a1887f' },
            { id: 6, name: 'Stone 07', color: '#6d4c41' },
            { id: 7, name: 'Stone 08', color: '#795548' }
        ];

        // Voxel state now owned by WorldManager (no duplicate storage)
        this.activeVoxels = new Map();
        this.raycaster = new THREE.Raycaster();
        this.selectedBlockType = 0;

        // --- GHOST TOGGLE ---
        this.showGhost = true;
        this.ghostToggleKey = 'g'; // Press 'G' to toggle

        // --- Material & Mesh Setup ---
        this.materials = [];
        this.meshes = [];
        this.nextFreeSlot = [];

        // 🔒 Cached raycast targets (avoids per-frame Array/Set creation)
        this.raycastTargets = [];

        // 🔒 CACHE STATIC WALLS FOR RAYCASTING FIRST (before pushing to targets)
        this.staticWallsMesh = null;
        for (const child of scene.children) {
            if (child.isInstancedMesh && !this.meshes.includes(child)) {
                this.staticWallsMesh = child;
                break;
            }
        }

        // Now push the cached mesh to raycast targets
        if (this.staticWallsMesh) {
            this.raycastTargets.push(this.staticWallsMesh);
            console.log(`✅ Cached static floor for raycasting: ${this.staticWallsMesh.count} instances`);
        }

        for (let i = 0; i < this.NUM_TYPES; i++) {
            // Use WorldManager's blockColors palette colors as base — no separate color calc.
            const colorHex = this.worldManager
                ? this.worldManager.blockColors[i]?.color ?? 0xffffff
                : new THREE.Color(this.BLOCK_TYPES[i].color).multiplyScalar(2).getHex();

            const initialMat = new THREE.MeshStandardMaterial({
                color: colorHex,
                roughness: 0.45,
                metalness: 0.15,
                map: null
            });

            this.materials.push(initialMat);



            const geo = new THREE.BoxGeometry(this.BLOCK_SIZE, this.BLOCK_SIZE, this.BLOCK_SIZE, 1, 1, 1);
            geo.side = THREE.DoubleSide;

            const mesh = new THREE.InstancedMesh(geo, initialMat, this.MAX_BLOCKS_PER_TYPE);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false; // Culling disabled to keep raycasting stable

            // 🔒 HIDE ALL UNUSED INSTANCES (prevents ghost blocks at origin)
            const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
            for (let i = 0; i < this.MAX_BLOCKS_PER_TYPE; i++) {
                mesh.setMatrixAt(i, hiddenMatrix);
            }
            mesh.instanceMatrix.needsUpdate = true;

            scene.add(mesh);
            this.meshes.push(mesh);
            this.raycastTargets.push(mesh); // 🔒 Cache for raycaster
            this.nextFreeSlot.push(0);
        }

        // --- WIREFRAME GHOST ---
        const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
        this.ghostEdge = new THREE.LineSegments(edgeGeo, edgeMat);

        const faceGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
        const faceMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false
        });
        this.ghostFace = new THREE.Mesh(faceGeo, faceMat);

        this.ghostGroup = new THREE.Group();
        this.ghostGroup.add(this.ghostEdge);
        this.ghostGroup.add(this.ghostFace);
        scene.add(this.ghostGroup);

        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('mousedown', (e) => this.onMouseDown(e));

        console.log("🔨 BuildSystem Initialized");
    }




    toggleGhost() {
        this.showGhost = !this.showGhost;

        // Immediately update visibility
        if (this.ghostGroup) {
            this.ghostGroup.visible = this.showGhost && /* existing hit check */ true;
        }

        console.log(`👻 Ghost ${this.showGhost ? 'enabled' : 'disabled'}`);
        return this.showGhost;
    }

    updateGhost() {
        if (!this.showGhost) {
            this.ghostGroup.visible = false;
            return;
        }

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            // 🔒 Reduced offset so ghost sits flush on surfaces (not floating above)
            const placeOffset = this.BLOCK_SIZE * 0.4 + 0.01;
            const ghostPos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(placeOffset));

            // 🔒 World-positioned with floor-based rounding (matches tryPlace logic)
            const gx = Math.round(ghostPos.x);
            const gy = Math.floor(ghostPos.y + 0.49); // Prevents 0.5 → 1 snap bug
            const gz = Math.round(ghostPos.z);

            const key = `${gx},${gy},${gz}`;

            if (!this.activeVoxels.has(key)) {
                this.ghostGroup.visible = true;

                // 🔒 Position in WORLD units for rendering, but use integer grid for logic
                this.ghostGroup.position.set(gx * this.BLOCK_SIZE, gy * this.BLOCK_SIZE, gz * this.BLOCK_SIZE);
                this.ghostGroup.scale.setScalar(this.BLOCK_SIZE);

                const selectedMat = this.materials[this.selectedBlockType];
                if (selectedMat) {
                    const ghostMat = selectedMat.clone();
                    ghostMat.opacity = 0.5;
                    ghostMat.transparent = true;
                    ghostMat.depthWrite = false;
                    this.ghostFace.material = ghostMat;

                    // Sync edge wireframe color to material base tint
                    if (selectedMat.color) {
                        this.ghostEdge.material.color.copy(selectedMat.color);
                    }
                }
            } else {
                this.ghostGroup.visible = false;
            }
        } else {
            this.ghostGroup.visible = false;
        }
    }

    _snapNormalToAxis(normal) {
        const absX = Math.abs(normal.x);
        const absY = Math.abs(normal.y);
        const absZ = Math.abs(normal.z);
        if (absX > absY && absX > absZ) return new THREE.Vector3(Math.sign(normal.x), 0, 0);
        else if (absY > absX && absY > absZ) return new THREE.Vector3(0, Math.sign(normal.y), 0);
        else return new THREE.Vector3(0, 0, Math.sign(normal.z));
    }

    roundToGrid(value) {
        const epsilon = 0.05;
        return Math.round((value + epsilon * Math.sign(value || 1)) / this.BLOCK_SIZE) * this.BLOCK_SIZE;
    }

    onKeyDown(e) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= this.NUM_TYPES) {
            this.selectedBlockType = num - 1;
            this.updateGhost(); // ✅ Refresh ghost color instantly on key press
        }
    }

    onMouseDown(e) {
        if (document.pointerLockElement === this.renderer.domElement && e.target.tagName !== 'CANVAS') return;
        if (e.button === 0) this.tryPlace();
        else if (e.button === 2) this.tryRemove();
    }

    tryPlace() {

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);

        if (intersects.length > 0) {
            const hit = intersects[0];

            // 🔒 Calculate target position with consistent surface offset
            const placePos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(
                this.BLOCK_SIZE * 0.5 + 0.01
            ));

            // 🔒 Use floor-based rounding to prevent floating blocks above geometry
            const gx = Math.round(placePos.x);
            const gy = Math.floor(placePos.y + 0.49); // Ensures y=0.5 → snaps to 0 (ground level)w
            const gz = Math.round(placePos.z);

            const key = `${gx},${gy},${gz}`;
            if (this.activeVoxels.has(key)) return;

            // 🔒 Terrain-aware support: blocks snap to procedural elevation
            const terrainHeight = this.worldManager._getTerrainElevation(gx, gz);
            const surfaceY = Math.floor(terrainHeight);
            let isSupported = gy <= surfaceY || this.activeVoxels.has(`${gx},${gy - 1},${gz}`);

            if (!isSupported) {
                const adjacentKeys = [
                    `${gx + 1},${gy},${gz}`, `${gx - 1},${gy},${gz}`,
                    `${gx},${gy + 1},${gz}`, `${gx},${gy - 1},${gz}`,
                    `${gx},${gy},${gz + 1}`, `${gx},${gy},${gz - 1}`
                ];
                isSupported = adjacentKeys.some(k => {
                    const [ax, ay, az] = k.split(',').map(Number);
                    return this.worldManager.getVoxelAt(ax, ay, az) > 0;
                });
            }

            if (isSupported) this.placeVoxel(gx, gy, gz, this.selectedBlockType);
        }
    }

    tryRemove() {
        if (!this.worldManager) return;

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.raycastTargets, false); // 🔒 Cached

        if (intersects.length > 0) {
            const hit = intersects[0];

            if (hit.object.isInstancedMesh && this.meshes.includes(hit.object)) {
                // BuildSystem own instanced blocks
                const mat = new THREE.Matrix4();
                hit.object.getMatrixAt(hit.instanceId, mat);
                const pos = new THREE.Vector3().setFromMatrixPosition(mat);
                const gx = Math.round(pos.x / this.BLOCK_SIZE);
                const gy = Math.round(pos.y / this.BLOCK_SIZE);
                const gz = Math.round(pos.z / this.BLOCK_SIZE);
                this.removeVoxel(gx, gy, gz);
            } else if (hit.object === this.staticWallsMesh) {
                // Static floor
                const pos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5));
                const gx = Math.round(pos.x / this.BLOCK_SIZE);
                const gy = Math.round(pos.y / this.BLOCK_SIZE);
                const gz = Math.round(pos.z / this.BLOCK_SIZE);
                const key = `${gx},${gy},${gz}`;
                if (this.activeVoxels.has(key)) this.removeVoxel(gx, gy, gz);
            } else if (this.worldManager) {
                // World chunk mesh — compute world-space voxel coords from hit point
                const pos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(-0.5));
                const gx = Math.round(pos.x);
                const gy = Math.round(pos.y);
                const gz = Math.round(pos.z);
                if (this.worldManager.getVoxelAt(gx, gy, gz) > 0) {
                    this.worldManager.removeBlock(gx, gy, gz);
                }
            }
        }
    }

    setWorldManager(wm) {
        // Register all currently-loaded chunk meshes as raycast targets
        if (!wm) return;
        this.worldManager = wm;

        // Sync textures from WorldManager into BuildSystem materials.
        // This must happen after WM finishes loading — not at construction time.
        if (wm.texturesReadyPromise) {
            wm.texturesReadyPromise.then(() => {
                for (let i = 0; i < this.materials.length; i++) {
                    const texData = wm.blockTextures.get(i + 1); // type indices 1-8
                    if (texData) {
                        this.materials[i].map = texData.base;
                        this.materials[i].normalMap = texData.normal;
                        this.materials[i].needsUpdate = true;
                        console.log(`✅ BuildSystem synced texture for type ${i + 1} from WorldManager`);
                    }
                }

                // Hide loading screen now that textures are available
                setTimeout(() => {
                    const loader = document.getElementById('loading-screen');
                    if (loader) {
                        loader.classList.add('hidden');
                        setTimeout(() => loader.remove(), 600);
                    }
                }, 300);
            }).catch(() => {}); // WM textures may fail silently
        }

        // Seed initial loaded chunks into raycastTargets
        const existingMeshes = wm.getAllMeshes();
        for (const mesh of existingMeshes) {
            if (!this.raycastTargets.includes(mesh)) {
                this.raycastTargets.push(mesh);
            }
        }

        // Wire callback so dynamically-created/rebuilt chunk meshes are auto-registered
        wm._onMeshCreated = (meshes) => {
            for (const mesh of Array.isArray(meshes) ? meshes : [meshes]) {
                if (!this.raycastTargets.includes(mesh)) {
                    this.raycastTargets.push(mesh);
                }
            }
        };
    }

    placeVoxel(x, y, z, typeId) {
        // Delegate to WorldManager — it owns voxel data and chunk mesh rebuilding
        if (this.worldManager) {
            this.worldManager.placeBlock(x, y, z, typeId);
            this.activeVoxels.set(`${x},${y},${z}`, typeId);
        }
    }

    removeVoxel(x, y, z) {
        // Delegate to WorldManager
        if (this.worldManager) {
            this.worldManager.removeBlock(x, y, z);
            this.activeVoxels.delete(`${x},${y},${z}`);
        }
    }
}
