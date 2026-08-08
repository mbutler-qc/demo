// world.js - Chunk-based Voxel World Manager with Procedural Terrain Generation
import * as THREE from 'three';

// Toggle texture loading on/off. Set false to disable async texture fetch and rely on solid-color fallbacks.
const LOAD_TEXTURES = true;

// ============================================================
// Perlin Noise (simplex-ish, seeded)
// ============================================================
class SimplexNoise {
    constructor(seed = 42) {
        this.perm = new Uint8Array(512);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = seed | 0;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807 + 0) % 2147483647;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }

    noise2D(x, y) {
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const G2 = (3 - Math.sqrt(3)) / 6;
        const s = (x + y) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);
        const x0 = x - (i - j * G2);
        const y0 = y - (s - i * G2);
        const i1 = x0 > y0 ? 1 : 0;
        const j1 = x0 > y0 ? 0 : 1;
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + (3 * G2 - 1);
        const x2 = x0 - 1 + (2 * G2);
        const y2 = y0 - 1 + (2 * G2 - 1);
        const ii = i & 255;
        const jj = j & 255;
        let t = 0.5 - x0 * x0 - y0 * y0;
        let n0 = 0, n1 = 0, n2 = 0;
        if (t >= 0) {
            const gi = this.perm[ii + this.perm[jj]] & 8;
            const dot0 = gi < 4 ? x0 * (gi & 1 ? 1 : -1) + y0 * (gi > 1 ? 1 : -1) : 0;
            n0 = t * t * dot0;
        }
        t = 0.5 - x1 * x1 - y1 * y1;
        if (t >= 0) {
            const gi = this.perm[ii + i1 + this.perm[jj + j1]] & 8;
            const dot1 = gi < 4 ? x1 * (gi & 1 ? 1 : -1) + y1 * (gi > 1 ? 1 : -1) : 0;
            n1 = t * t * dot1;
        }
        t = 0.5 - x2 * x2 - y2 * y2;
        if (t >= 0) {
            const gi = this.perm[ii + 1 + this.perm[jj + 1]] & 8;
            const dot2 = gi < 4 ? x2 * (gi & 1 ? 1 : -1) + y2 * (gi > 1 ? 1 : -1) : 0;
            n2 = t * t * dot2;
        }
        return 70 * (n0 + n1 + n2);
    }

    noise3D(x, y, z) {
        const F3 = 1 / 3;
        const G3 = 1 / 6;
        const s = (x + y + z) * F3;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);
        const k = Math.floor(z + s);
        const x0 = x - (i - j * G3 - k * G3);
        const y0 = y - (s - i * G3 - k * G3);
        const z0 = z - (s - i * G3 - j * G3);
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
            else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
            else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
        } else {
            if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
            else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
            else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
        }
        const x1 = x0 - i1 + G3;
        const y1 = y0 - j1 + G3;
        const z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2 * G3;
        const y2 = y0 - j2 + 2 * G3;
        const z2 = z0 - k2 + 2 * G3;
        const x3 = x0 - 1 + 3 * G3;
        const y3 = y0 - 1 + 3 * G3;
        const z3 = z0 - 1 + 3 * G3;
        const ii = i & 255, jj = j & 255, kk = k & 255;
        let val = 0;
        const grad = (hash, x, y, z) => {
            const h = hash & 15;
            const u = h < 8 ? x : y;
            const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
            return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
        };
        let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
        if (t0 > 0) { val += t0*t0 * grad(this.perm[ii+this.perm[jj+this.perm[kk]]], x0, y0, z0); }
        let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
        if (t1 > 0) { val += t1*t1 * grad(this.perm[ii+i1+this.perm[jj+j1+this.perm[kk+k1]]], x1, y1, z1); }
        let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
        if (t2 > 0) { val += t2*t2 * grad(this.perm[ii+i2+this.perm[jj+j2+this.perm[kk+k2]]], x2, y2, z2); }
        let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
        if (t3 > 0) { val += t3*t3 * grad(this.perm[ii+1+this.perm[jj+1+this.perm[kk+1]]], x3, y3, z3); }
        return 32 * val;
    }
}

// ============================================================
// Chunk - single 16×16×16 voxel region
// ============================================================
class VoxelChunk {

    constructor(cx, cy, cz, worldSeed) {
        this.cx = cx; // chunk X index
        this.cy = cy; // chunk Y index (vertical layer)
        this.cz = cz; // chunk Z index

        this.SIZE = 8;

        // Voxel data: flat array of type IDs, 0 = air
        this.voxels = new Int8Array(this.SIZE * this.SIZE * this.SIZE);
        this.dirty = true;

        // World-space origin of this chunk
        this.originX = cx * this.SIZE;
        this.originY = cy * this.SIZE;
        this.originZ = cz * this.SIZE;

        // Mesh reference
        this.mesh = null;

        // Seed for terrain generation
        this.worldSeed = worldSeed || 42;
    }

    toLocal(wx, wy, wz) {
        return {
            x: wx - this.originX,
            y: wy - this.originY,
            z: wz - this.originZ
        };
    }

    getVoxel(wx, wy, wz) {
        const lx = wx - this.originX;
        const ly = wy - this.originY;
        const lz = wz - this.originZ;
        if (lx < 0 || lx >= this.SIZE || ly < 0 || ly >= this.SIZE || lz < 0 || lz >= this.SIZE) return 0;
        return this.voxels[lx + ly * this.SIZE + lz * this.SIZE * this.SIZE] || 0;
    }

    setVoxel(wx, wy, wz, type) {
        const lx = wx - this.originX;
        const ly = wy - this.originY;
        const lz = wz - this.originZ;
        if (lx < 0 || lx >= this.SIZE || ly < 0 || ly >= this.SIZE || lz < 0 || lz >= this.SIZE) return false;
        this.voxels[lx + ly * this.SIZE + lz * this.SIZE * this.SIZE] = type;
        this.dirty = true;
        return true;
    }

    buildMesh(blockColors) {
        const geometries = [];

        for (let type = 1; type <= blockColors.length; type++) {
            if (!blockColors[type]) continue;

            const positions = [];
            const normals = [];
            const uvs = [];
            const indices = [];
            let vertexCount = 0;

            for (let y = 0; y < this.SIZE; y++) {
                for (let z = 0; z < this.SIZE; z++) {
                    for (let x = 0; x < this.SIZE; x++) {
                        const idx = x + y * this.SIZE + z * this.SIZE * this.SIZE;
                        if (this.voxels[idx] !== type) continue;

                        const wx = this.originX + x;
                        const wy = this.originY + y;
                        const wz = this.originZ + z;

                        const dirs = [
                            { key: '1,0,0', dx: 1, dy: 0, dz: 0, normal: [1, 0, 0] },
                            { key: '-1,0,0', dx: -1, dy: 0, dz: 0, normal: [-1, 0, 0] },
                            { key: '0,1,0', dx: 0, dy: 1, dz: 0, normal: [0, 1, 0] },
                            { key: '0,-1,0', dx: 0, dy: -1, dz: 0, normal: [0, -1, 0] },
                            { key: '0,0,1', dx: 0, dy: 0, dz: 1, normal: [0, 0, 1] },
                            { key: '0,0,-1', dx: 0, dy: 0, dz: -1, normal: [0, 0, -1] }
                        ];

                        for (const dir of dirs) {
                            const nx = wx + dir.dx;
                            const ny = wy + dir.dy;
                            const nz = wz + dir.dz;

                            let isFaceVisible = false;
                            if (this.getVoxel(nx, ny, nz) === 0 || this.getVoxel(nx, ny, nz) !== type) {
                                isFaceVisible = true;
                            }

                            if (!isFaceVisible) continue;

                            const h = 0.5;

                            switch (dir.key) {
                                case '1,0,0':
                                    positions.push(wx+h,wy-h,wz-h, wx+h,wy+h,wz-h, wx+h,wy+h,wz+h, wx+h,wy-h,wz+h);
                                    normals.push(1,0,0, 1,0,0, 1,0,0, 1,0,0);
                                    uvs.push(0,0, 0,1, 1,1, 1,0); // u along Z, v along Y
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                                case '-1,0,0':
                                    positions.push(wx-h,wy-h,wz+h, wx-h,wy+h,wz+h, wx-h,wy+h,wz-h, wx-h,wy-h,wz-h);
                                    normals.push(-1,0,0, -1,0,0, -1,0,0, -1,0,0);
                                    uvs.push(1,0, 1,1, 0,1, 0,0); // flipped Z winding
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                                case '0,1,0':
                                    positions.push(wx-h,wy+h,wz-h, wx-h,wy+h,wz+h, wx+h,wy+h,wz+h, wx+h,wy+h,wz-h);
                                    normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
                                    uvs.push(0,0, 1,0, 1,1, 0,1); // u along X, v along Z
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                                case '0,-1,0':
                                    positions.push(wx-h,wy-h,wz+h, wx-h,wy-h,wz-h, wx+h,wy-h,wz-h, wx+h,wy-h,wz+h);
                                    normals.push(0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0);
                                    uvs.push(1,0, 1,1, 0,1, 0,0); // flipped Z winding
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                                case '0,0,1':
                                    positions.push(wx-h,wy-h,wz+h, wx+h,wy-h,wz+h, wx+h,wy+h,wz+h, wx-h,wy+h,wz+h);
                                    normals.push(0,0,1, 0,0,1, 0,0,1, 0,0,1);
                                    uvs.push(0,0, 1,0, 1,1, 0,1); // u along X, v along Y
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                                case '0,0,-1':
                                    positions.push(wx+h,wy-h,wz-h, wx-h,wy-h,wz-h, wx-h,wy+h,wz-h, wx+h,wy+h,wz-h);
                                    normals.push(0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1);
                                    uvs.push(1,0, 0,0, 0,1, 1,1); // flipped X winding
                                    indices.push(vertexCount,vertexCount+1,vertexCount+2, vertexCount,vertexCount+2,vertexCount+3);
                                    vertexCount += 4;
                                    break;
                            }
                        }
                    }
                }
            }

            if (vertexCount === 0) continue;

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setIndex(indices);
            geometries.push({ geo, color: blockColors[type] });
        }

        if (geometries.length === 0) {
            this.mesh = null;
            return null;
        }

        return { geometries };
    }

    // Multi-octave (FBM) elevation for natural hills/valleys instead of flat plateaus
    _fbmElevation(wx, wz) {
        const n = this.elevationNoise;
        let h = n.noise2D(wx * 0.015, wz * 0.015) * 3;
        h += n.noise2D(wx * 0.03, wz * 0.03) * 1.5;
        h += n.noise2D(wx * 0.06, wz * 0.06) * 0.75;
        return h + 2; // smooth float elevation (no floor), base ~2, range roughly [-4, 7] — gentle hills
    }

    generateTerrain(elevationNoise, moistureNoise, tempNoise) {
        this.elevationNoise = elevationNoise; // bind per-chunk reference for FBM

        // No per-column cache — elevation now varies with world-y, so we compute inline.

        for (let y = 0; y < this.SIZE; y++) {
            for (let z = 0; z < this.SIZE; z++) {
                for (let x = 0; x < this.SIZE; x++) {
                    const wx = this.originX + x;
                    const wy_world = this.originY + y;
                    const wz = this.originZ + z;
                    const surfaceHeight = this._fbmElevation(wx, wz);

                    // Temperature and moisture for biome (world-space)
                    const temperature = tempNoise.noise2D(wx * 0.015, wz * 0.015);
                    const moisture = moistureNoise.noise2D(wx * 0.015, wz * 0.015);

                    let type = 0; // air by default

                    if (wy_world <= surfaceHeight) {
                        // Surface blocks: grass, sand, or snow depending on biome
                        if (temperature > 0.3 && moisture < -0.2) {
                            type = 2; // Desert → sand
                        } else if (temperature < -0.3) {
                            type = 6; // Snowy → stone/snow proxy
                        } else {
                            type = 1; // Plains/Forest → grass

                            // Trees: use world-space hash so they don't grid-repeat across chunk boundaries
                            if (moisture > 0.1 && temperature > -0.1 && temperature < 0.4) {
                                const hash = ((wx * 738560937) ^ (wz * 19349663)) & 0xFFFF;
                                if (y === Math.floor(surfaceHeight) + 1 && hash % 13 === 5) {
                                    type = 5; // wood trunk
                                } else if (y === Math.floor(surfaceHeight) + 2 && ((hash >> 8) % 13 === 5)) {
                                    type = 7; // leaves approximation
                                }
                            }
                        }
                    } else {
                        // Below surface: depth-based geological layering
                        const depthFromSurface = Math.floor(surfaceHeight) - wy_world;
                        if (depthFromSurface >= -1 && depthFromSurface <= 2) {
                            type = 4; // dirt — topsoil layer just below surface
                        } else if (depthFromSurface > 2) {
                            type = 3; // stone — deeper geological layer
                        }
                        // else: wy_world slightly above floor(surfaceHeight), leave as air (0)
                    }

                    const idx = x + y * this.SIZE + z * this.SIZE * this.SIZE;
                    this.voxels[idx] = type;
                }
            }
        }

        this.dirty = false;
    }
}

// ============================================================
// WorldManager - manages all chunks, loading/unloading, block ops
// ============================================================
export class WorldManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.CHUNK_SIZE = 8; // Aligned with VoxelChunk.SIZE
        this.LOAD_RADIUS = 6; // chunks in each direction (~96 blocks)
        this.UNLOAD_RADIUS = 8; // unload when beyond this distance

        // Block type colors (matching BuildSystem palette indices)
        this.blockColors = [
            null,      // 0 = air
            { type: 1, color: 0x8d6e63 },   // 1 = grass/dirt
            { type: 2, color: 0xf5deb3 },   // 2 = sand
            { type: 3, color: 0xffffff },   // 3 = snow/ice
            { type: 4, color: 0x8B4513 },   // 4 = dirt
            { type: 5, color: 0x5d4e37 },   // 5 = wood trunk
            { type: 6, color: 0xa1887f },   // 6 = stone/snow proxy
            { type: 7, color: 0x2e7d32 },   // 7 = leaves
            { type: 8, color: 0x795548 }    // 8 = brick/rock
        ];

        // Per-type texture maps (basecolor + normal) loaded async
        this.blockTextures = new Map();

        this.chunks = new Map();
        this.elevationNoise = new SimplexNoise(12345);
        this.moistureNoise = new SimplexNoise(67890);
        this.tempNoise = new SimplexNoise(11111);

        // Callback for registering chunk meshes into a raycaster's targets list
        this._onMeshCreated = null;

        this.loadedChunkCount = 0;
        this.totalVoxelCount = 0;

        // Promise that resolves when all block textures are loaded
        this.texturesReadyPromise = null;

        console.log("🌍 WorldManager initialized");

        if (LOAD_TEXTURES) {
            // Load textures for each block type (1-8)
            this._loadBlockTextures();
        } else {
            console.log("⏭️ Texture loading disabled — using solid-color fallbacks.");
        }
    }

    _debugFaceColor(normalAttr) {
        if (!normalAttr || !normalAttr.array) return null;
        const arr = normalAttr.array;
        let sx = 0, sy = 0, sz = 0; // sum of per-vertex normals
        for (let i = 0; i < arr.length; i += 3) {
            sx += arr[i];
            sy += arr[i + 1];
            sz += arr[i + 2];
        }
        const n = new THREE.Vector3(sx, sy, sz).normalize();
        // Pick the dominant axis
        if (Math.abs(n.y) > Math.abs(n.x) && Math.abs(n.y) > Math.abs(n.z)) {
            return n.y > 0 ? 0xff0000 : 0x00ff00; // top=red, bottom=green
        }
        if (Math.abs(n.x) > Math.abs(n.z)) {
            return n.x > 0 ? 0x00ff00 : 0x0000ff; // right=green, left=blue
        }
        return n.z > 0 ? 0xffff00 : 0xff00ff; // front=yellow, back=magenta (fallback)
    }

    _loadBlockTextures() {
        const pending = [];

        for (let i = 1; i <= 8; i++) {
            const basePath = `./textures/Materials_StoneFloor/StoneFloor_0${i}/`;
            pending.push(
                Promise.all([
                    this._loadTex(`${basePath}StoneFloor_0${i}_basecolor.jpg`, true),
                    this._loadTex(`${basePath}StoneFloor_0${i}_normal.jpg`, false)
                ]).then(([baseTex, normTex]) => {
                    this.blockTextures.set(i, { base: baseTex, normal: normTex });
                    console.log(`✅ WorldManager texture loaded for block type ${i}`);
                    this._rebuildLoadedChunksWithTextures();
                }).catch(err => {
                    console.warn(`⚠️ Failed to load textures for block type ${i}, using fallback color.`);
                })
            );
        }

        this.texturesReadyPromise = Promise.all(pending).then(() => {
            console.log("✅ All WorldManager textures loaded");
        }).catch(err => {
            console.warn("⚠️ Some WorldManager textures failed to load:", err);
        });
    }

    // Rebuild existing chunk meshes now that textures are available
    _rebuildLoadedChunksWithTextures() {
        for (const chunk of this.chunks.values()) {
            if (!chunk.mesh || !Array.isArray(chunk.mesh)) continue;

            // Remove old meshes from scene
            for (const mesh of chunk.mesh) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            chunk.mesh = null;
        }

        // Rebuild every loaded chunk with proper texture materials
        for (const chunk of this.chunks.values()) {
            const buildResult = chunk.buildMesh(this.blockColors);
            if (!buildResult) continue;

            const { geometries } = buildResult;
            const newMeshes = [];

            for (const { geo, color } of geometries) {
                if (geo.attributes.position.count === 0) continue;

                // Regular Mesh — positions baked in world coords during buildMesh
                const mat = this._makeFaceMaterial(color, geo);
                const mesh = new THREE.Mesh(geo.clone(), mat);
                newMeshes.push(mesh);
                this.scene.add(mesh);
            }

            chunk.mesh = newMeshes;
        }
    }

    _loadTex(path, isAlbedo) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                path,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.repeat.set(4, 4);
                    if (isAlbedo) {
                        texture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    } else {
                        texture.encoding = THREE.LinearEncoding;
                        texture.flipY = true;
                    }
                    resolve(texture);
                },
                undefined,
                (err) => {
                    console.error(`❌ _loadTex FAILED: ${path}`, err);
                    reject(err);
                }
            );
        });
    }

    // Build a material for one face geometry — handles texture fallback and debug coloring in one place.
    _makeFaceMaterial(color, geo) {
        const texData = this.blockTextures.get(color.type || 1);
        const faceCol = LOAD_TEXTURES ? null : this._debugFaceColor(geo.attributes.normal);
        return texData
            ? new THREE.MeshStandardMaterial({
                color: faceCol !== null ? faceCol : color.color,
                roughness: 0.8,
                metalness: 0.1,
                map: texData.base,
                normalMap: texData.normal
            })
            : new THREE.MeshStandardMaterial({
                color: faceCol !== null ? faceCol : color.color,
                roughness: 0.8,
                metalness: 0.1
            });
    }

    _chunkKey(cx, cy, cz) {
        return `${cx},${cy},${cz}`;
    }

    getChunkAt(wx, wy, wz) {
        const cx = Math.floor(wx / this.CHUNK_SIZE);
        const cy = Math.floor(wy / this.CHUNK_SIZE);
        const cz = Math.floor(wz / this.CHUNK_SIZE);
        return this._getOrLoadChunk(cx, cy, cz);
    }

    _getOrLoadChunk(cx, cy, cz) {
        const key = this._chunkKey(cx, cy, cz);
        let chunk = this.chunks.get(key);

        if (!chunk) {
            chunk = new VoxelChunk(cx, cy, cz, 42);

            // Generate terrain
            chunk.generateTerrain(this.elevationNoise, this.moistureNoise, this.tempNoise);

            // Build mesh — terrain chunks use regular Mesh (not InstancedMesh)
            const buildResult = chunk.buildMesh(this.blockColors);
            if (buildResult) {
                const { geometries } = buildResult;
                const meshes = [];

                for (const { geo, color } of geometries) {
                    if (geo.attributes.position.count === 0) continue;

                    // Clone geometry so each mesh has its own BufferAttribute arrays
                    const clonedGeo = geo.clone();
                    const mat = this._makeFaceMaterial(color, geo);

                    const mesh = new THREE.Mesh(clonedGeo, mat);
                    meshes.push(mesh);
                    this.scene.add(mesh);
                }

                chunk.mesh = meshes;
            } else {
                chunk.mesh = null;
            }

            // Register new meshes with raycaster targets
            if (this._onMeshCreated && chunk.mesh) {
                this._onMeshCreated(chunk.mesh);
            }

            this.chunks.set(key, chunk);
            this.loadedChunkCount++;
        }

        return chunk;
    }

    update() {
        const px = Math.floor(this.camera.position.x / this.CHUNK_SIZE);
        const py = Math.floor(this.camera.position.y / this.CHUNK_SIZE);
        const pz = Math.floor(this.camera.position.z / this.CHUNK_SIZE);

        // Load chunks around player
        for (let cx = px - this.LOAD_RADIUS; cx <= px + this.LOAD_RADIUS; cx++) {
            for (let cz = pz - this.LOAD_RADIUS; cz <= pz + this.LOAD_RADIUS; cz++) {
                for (let cy = py - 2; cy <= py + 4; cy++) {
                    this._getOrLoadChunk(cx, cy, cz);
                }
            }
        }

        // Unload distant chunks
        const toUnload = [];
        for (const [key, chunk] of this.chunks) {
            const dx = Math.abs(chunk.cx - px);
            const dy = Math.abs(chunk.cy - py);
            const dz = Math.abs(chunk.cz - pz);

            if (dx > this.UNLOAD_RADIUS || dy > this.UNLOAD_RADIUS || dz > this.UNLOAD_RADIUS) {
                if (chunk.mesh && Array.isArray(chunk.mesh)) {
                    for (const mesh of chunk.mesh) {
                        this.scene.remove(mesh);
                        mesh.geometry.dispose();
                        mesh.material.dispose();
                    }
                }
                toUnload.push(key);
            }
        }

        for (const key of toUnload) {
            this.chunks.delete(key);
            this.loadedChunkCount--;
        }

        let totalVoxels = 0;
        for (const chunk of this.chunks.values()) {
            totalVoxels += chunk.size * chunk.size * chunk.size;
        }
        this.totalVoxelCount = totalVoxels;
    }

    placeBlock(wx, wy, wz, type) {
        const chunk = this.getChunkAt(wx, wy, wz);
        if (chunk.setVoxel(wx, wy, wz, type)) {
            this._rebuildChunkMesh(chunk);
            return true;
        }
        return false;
    }

    removeBlock(wx, wy, wz) {
        const chunk = this.getChunkAt(wx, wy, wz);
        if (chunk.setVoxel(wx, wy, wz, 0)) { // 0 = air
            this._rebuildChunkMesh(chunk);
            return true;
        }
        return false;
    }

    _rebuildChunkMesh(chunk) {
        // Always rebuild during texture-first-pass to apply maps
        const texRebuild = chunk._textureRebuildNeeded;
        if (!chunk.dirty && !texRebuild) return;

        // Remove old meshes from scene
        if (chunk.mesh && Array.isArray(chunk.mesh)) {
            for (const mesh of chunk.mesh) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
        }

        const buildResult = chunk.buildMesh(this.blockColors);
        if (!buildResult) {
            chunk.mesh = null;
            return;
        }

        const { geometries } = buildResult;
        const newMeshes = [];

        for (const { geo, color } of geometries) {
            if (geo.attributes.position.count === 0) continue;

            // Use regular Mesh — geometry positions are already in world coordinates
            // (baked during buildMesh). InstancedMesh with identity matrices would
            // stack all faces at origin instead of distributing across voxel grid.
            const mat = this._makeFaceMaterial(color, geo);

            const mesh = new THREE.Mesh(geo.clone(), mat);
            newMeshes.push(mesh);
            this.scene.add(mesh);
        }

        chunk.mesh = newMeshes;
        chunk.dirty = false;

        // Register new meshes with raycaster targets
        if (this._onMeshCreated && newMeshes.length > 0) {
            this._onMeshCreated(newMeshes);
        }
    }

    getVoxelAt(wx, wy, wz) {
        const cx = Math.floor(wx / this.CHUNK_SIZE);
        const cy = Math.floor(wy / this.CHUNK_SIZE);
        const cz = Math.floor(wz / this.CHUNK_SIZE);

        const key = this._chunkKey(cx, cy, cz);
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = this._getOrLoadChunk(cx, cy, cz);
        }

        return chunk.getVoxel(wx, wy, wz);
    }

    // Get terrain surface height at world coordinates (wx, wz)
    _getTerrainElevation(wx, wz) {
        // Elevation is purely a function of (wx, wz), independent of which chunk we sample from.
        // Query any loaded chunk in this column rather than forcing cy=0 — that avoids querying
        // an empty/unloaded chunk column when terrain sits above y=0.
        const cx = Math.floor(wx / this.CHUNK_SIZE);
        const cz = Math.floor(wz / this.CHUNK_SIZE);
        let chunk = null;
        for (const c of this.chunks.values()) {
            if (c.cx === cx && c.cz === cz) { chunk = c; break; }
        }
        if (!chunk) {
            // Find the highest loaded chunk in this column and reuse it
            let maxY = -Infinity;
            for (const [key, c] of this.chunks) {
                if (c.cx === cx && c.cz === cz && c.cy > maxY) { maxY = c.cy; chunk = c; }
            }
        }
        if (!chunk) {
            // No chunks loaded in column — load one at cy=0 as fallback
            chunk = this._getOrLoadChunk(cx, 0, cz);
        }
        return chunk._fbmElevation(wx, wz);
    }

    getStats() {
        return {
            loadedChunks: this.loadedChunkCount,
            totalVoxels: this.totalVoxelCount,
            loadRadius: this.LOAD_RADIUS,
            chunkSize: this.CHUNK_SIZE
        };
    }

    getAllMeshes() {
        const meshes = [];
        for (const chunk of this.chunks.values()) {
            if (chunk.mesh && Array.isArray(chunk.mesh)) {
                meshes.push(...chunk.mesh);
            }
        }
        return meshes;
    }
}

export { VoxelChunk };
