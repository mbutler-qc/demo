// buildSystem.js - Performance-Optimized 3D Voxel Building Module
import * as THREE from 'three';

export class BuildSystem {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

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

        this.activeVoxels = new Map();
        this.textureLoadState = { loaded: 0, total: this.NUM_TYPES * 2 };
        this.allTexturesLoaded = false;
        this.raycaster = new THREE.Raycaster();
        this.selectedBlockType = 0;

        // --- GHOST TOGGLE ---
        this.showGhost = true;
        this.ghostToggleKey = 'g'; // Press 'G' to toggle

        this.texLoader = new THREE.TextureLoader();

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
            const basePath = `./textures/Materials_StoneFloor/StoneFloor_0${i + 1}/`;
            const baseColor = new THREE.Color(this.BLOCK_TYPES[i].color).multiplyScalar(2);

            const initialMat = new THREE.MeshStandardMaterial({
                color: baseColor,
                roughness: 0.45,
                metalness: 0.15,
                map: null
            });

            this.materials.push(initialMat);

            // 🚀 PERFORMANCE FIX: Apply textures directly to the existing material.
            // Cloning forces shader recompilation + GPU buffer rebuilds, which is why
            // your previous code had to manually re-upload all instance matrices.
            Promise.all([
                this.loadTextureSafe(`${basePath}StoneFloor_0${i + 1}_basecolor.jpg`, true),
                this.loadTextureSafe(`${basePath}StoneFloor_0${i + 1}_normal.jpg`, false)
            ]).then(([baseTex, normTex]) => {
                initialMat.map = baseTex;
                initialMat.normalMap = normTex;
                initialMat.needsUpdate = true;

                // Update loading progress
                this.textureLoadState.loaded += 2;
                this.updateLoadingUI();

                console.log(`✅ Texture loaded & applied to Block Type ${i + 1}`);
            }).catch(err => {
                console.warn(`⚠️ Failed to load textures for StoneFloor_0${i + 1}, keeping fallback.`);

                // Even on failure, we still count them as "loaded" to avoid stalling the loading screen
                this.textureLoadState.loaded += 2;
                this.updateLoadingUI();
            });

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

    updateLoadingUI() {
        if (typeof document === 'undefined') return; // Not in browser

        const progress = Math.min(100, Math.round((this.textureLoadState.loaded / this.textureLoadState.total) * 100));
        const fill = document.getElementById('load-progress');
        const status = document.getElementById('load-status');

        if (fill && status) {
            fill.style.width = `${progress}%`;

            // Update status text based on progress
            if (progress < 50) {
                status.textContent = `Loading materials... ${this.textureLoadState.loaded}/${this.textureLoadState.total}`;
            } else if (progress < 100) {
                status.textContent = 'Applying textures...';
            } else {
                status.textContent = 'Finalizing scene...';
                this.allTexturesLoaded = true;

                // Hide loading screen after brief delay
                setTimeout(() => {
                    const loader = document.getElementById('loading-screen');
                    if (loader) {
                        loader.classList.add('hidden');
                        setTimeout(() => loader.remove(), 600);
                    }
                }, 300);
            }
        }
    }

    loadTextureSafe(path, isAlbedo) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                path,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.repeat.set(1, 1);

                    // 🔒 COMPATIBILITY FIX: Modern Three.js uses colorSpace, legacy uses encoding
                    if (isAlbedo) {
                        texture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    } else {
                        texture.encoding = THREE.LinearEncoding;
                        texture.flipY = true;
                    }

                    resolve(texture);
                },
                undefined,
                reject
            );
        });
    }

    syncFromMap(mapData, MAP_W, MAP_H, typeId) {
        const W = mapData[0].length;
        const H = mapData.length;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (mapData[y][x] === 1) {
                    const vx = Math.floor(x - MAP_W / 2 + 0.5);
                    const vz = Math.floor(y - MAP_H / 2 + 0.5);
                    this.placeVoxel(vx, 0, vz, typeId);
                }
            }
        }
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
        if (!this.staticWallsMesh) return;

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);

        // 🔒 Hide ghost immediately if disabled (no raycast needed)
        if (!this.showGhost) {
            this.ghostGroup.visible = false;
            return;
        }

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
        if (!this.staticWallsMesh) return;

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

            // 🔒 Ground plane at y≤0 is always valid support, or check adjacent/underlying voxels
            let isSupported = gy <= 0 || this.activeVoxels.has(`${gx},${gy - 1},${gz}`);

            if (!isSupported) {
                const adjacentKeys = [
                    `${gx + 1},${gy},${gz}`, `${gx - 1},${gy},${gz}`,
                    `${gx},${gy + 1},${gz}`, `${gx},${gy - 1},${gz}`,
                    `${gx},${gy},${gz + 1}`, `${gx},${gy},${gz - 1}`
                ];
                isSupported = adjacentKeys.some(k => this.activeVoxels.has(k));
            }

            if (isSupported) this.placeVoxel(gx, gy, gz, this.selectedBlockType);
        }
    }

    tryRemove() {
        if (!this.staticWallsMesh) return;

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.raycastTargets, false); // 🔒 Cached

        if (intersects.length > 0) {
            const hit = intersects[0];

            if (hit.object.isInstancedMesh && this.meshes.includes(hit.object)) {
                const mat = new THREE.Matrix4();
                hit.object.getMatrixAt(hit.instanceId, mat);
                const pos = new THREE.Vector3().setFromMatrixPosition(mat);
                const gx = Math.round(pos.x / this.BLOCK_SIZE);
                const gy = Math.round(pos.y / this.BLOCK_SIZE);
                const gz = Math.round(pos.z / this.BLOCK_SIZE);
                this.removeVoxel(gx, gy, gz);
            } else if (hit.object === this.staticWallsMesh) {
                const pos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5));
                const gx = Math.round(pos.x / this.BLOCK_SIZE);
                const gy = Math.round(pos.y / this.BLOCK_SIZE);
                const gz = Math.round(pos.z / this.BLOCK_SIZE);
                const key = `${gx},${gy},${gz}`;
                if (this.activeVoxels.has(key)) this.removeVoxel(gx, gy, gz);
            }
        }
    }

    placeVoxel(x, y, z, typeId) {
        if (typeId < 0 || typeId >= this.NUM_TYPES) return;
        const key = `${x},${y},${z}`;
        if (this.activeVoxels.has(key)) return;

        const mesh = this.meshes[typeId];
        let idx = -1;

        // 🔒 Efficient free-slot scan from current cursor position
        for (let i = this.nextFreeSlot[typeId]; i < this.MAX_BLOCKS_PER_TYPE; i++) {
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(i, mat);
            if (mat.elements[12] === 0 && mat.elements[13] === 0 && mat.elements[14] === 0) {
                idx = i;
                this.nextFreeSlot[typeId] = Math.max(this.nextFreeSlot[typeId], i + 1);
                break;
            }
        }

        if (idx === -1) return;

        this.activeVoxels.set(key, { x, y, z, type: typeId, id: idx });
        const matrix = new THREE.Matrix4();
        matrix.setPosition(x * this.BLOCK_SIZE, y * this.BLOCK_SIZE, z * this.BLOCK_SIZE);
        mesh.setMatrixAt(idx, matrix);
        mesh.instanceMatrix.needsUpdate = true;

        // 🔒 Bounding box preserved exactly as before for raycasting/frustum stability
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
    }

    removeVoxel(x, y, z) {
        const key = `${x},${y},${z}`;
        if (!this.activeVoxels.has(key)) return;

        const blockData = this.activeVoxels.get(key);
        const mesh = this.meshes[blockData.type];
        const idx = blockData.id;

        this.activeVoxels.delete(key);
        const mat = new THREE.Matrix4().makeScale(0, 0, 0);
        mesh.setMatrixAt(idx, mat);
        mesh.instanceMatrix.needsUpdate = true;
    }
}
