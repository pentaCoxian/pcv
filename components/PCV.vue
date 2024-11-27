<template>
    <div class="pointcloud-viewer">
      <!-- Three.js Container -->
      <div ref="threeContainer" class="three-container"></div>
  
      <!-- Error and Loading Messages -->
      <div v-if="error" class="error-message">
        {{ error }}
      </div>
      <div v-if="loading" class="loading-message">
        Loading point cloud data...
      </div>
    </div>
  </template>
  
  <script>
  import { ref, onMounted, onUnmounted } from 'vue';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import * as pako from 'pako';
  
  export default {
    setup() {
      const threeContainer = ref(null);
      const error = ref(null);
      const loading = ref(false);
  
      let scene, camera, renderer, controls;
      let pointCloud;
      let isActive = true;
  
      // Variables for point cloud data
      let geometry, material;
      let positions, colors;
      let maxPoints = 0;
      let isFirstUpdate = true;
      let isProcessing = false; // Flag to indicate if a frame is being processed
  
      let websocket;
  
      const initThree = () => {
        try {
          const container = threeContainer.value;
          if (!container) {
            throw new Error('Container element not found');
          }
  
          const width = container.clientWidth;
          const height = container.clientHeight;
  
          // Initialize scene
          scene = new THREE.Scene();
          scene.background = new THREE.Color(0x000000);
          console.log("Three init");
          // Initialize camera
          camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
          camera.position.set(0, 0, 5);
  
          // Initialize renderer
          renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(width, height);
          renderer.setPixelRatio(window.devicePixelRatio);
          container.appendChild(renderer.domElement);
          console.log("child append");
          // Initialize controls
          controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.05;
  
          // Initialize geometry and material
          geometry = new THREE.BufferGeometry();
  
          material = new THREE.PointsMaterial({
            size: 0.01,
            vertexColors: true,
          });
  
          // Initialize point cloud
          pointCloud = new THREE.Points(geometry, material);
          scene.add(pointCloud);
          console.log("stating animation...");
          // Start animation loop
          animate();
        } catch (err) {
          console.error('Error initializing Three.js:', err);
          error.value = 'Failed to initialize 3D viewer';
        }
      };
  
      const animate = () => {
        if (!isActive) return;
  
        // Update controls
        controls.update();
  
        // Render
        renderer.render(scene, camera);
  
        // Schedule next frame
        requestAnimationFrame(animate);
      };
  
      const connectWebSocket = () => {
        loading.value = true;
        error.value = null;
  
        // Replace 'localhost' and '8765' with your server's address and port
        websocket = new WebSocket('ws://localhost:8765');
        websocket.binaryType = 'arraybuffer';
  
        websocket.onopen = () => {
          console.log('WebSocket connection opened');
          loading.value = false;
        };
  
        websocket.onmessage = (event) => {
            console.log(event.data);
            handleWebSocketMessage(event.data);
          
        };
  
        websocket.onerror = (err) => {
          console.error('WebSocket error:', err);
          error.value = 'WebSocket connection error';
          loading.value = false;
        };
  
        websocket.onclose = () => {
          console.log('WebSocket connection closed');
          error.value = 'WebSocket connection closed';
        };
      };
  
      const handleWebSocketMessage = (data) => {
        // If currently processing a frame, ignore new frames
        if (isProcessing) {
          console.log('Frame received but still processing previous frame. Bouncing frame.');
          return;
        }
  
        isProcessing = true;
  
        // Decompress and parse the data
        parsePointCloudData(data);
      };
  
      const parsePointCloudData = (data) => {
        try {
          // Decompress data using pako
          const compressedData = new Uint8Array(data);
          const decompressedData = pako.inflate(compressedData);
  
          // Parse point cloud data
          const dataView = new DataView(decompressedData.buffer);
          let offset = 0;
  
          // Read number of points (uint32)
          const numPoints = dataView.getUint32(offset, true);
          offset += 4;
  
          // Read has_colors flag (uint8)
          const hasColors = dataView.getUint8(offset);
          offset += 1;
  
          // Read positions
          const positionsArray = new Float32Array(numPoints * 3);
          for (let i = 0; i < numPoints * 3; i++) {
            positionsArray[i] = dataView.getFloat32(offset, true);
            offset += 4;
          }
  
          // Read colors if available
          let colorsArray = null;
          if (hasColors) {
            colorsArray = new Uint8Array(numPoints * 3);
            for (let i = 0; i < numPoints * 3; i++) {
              colorsArray[i] = dataView.getUint8(offset);
              offset += 1;
            }
          }
  
          // Update the point cloud
          updatePointCloud(positionsArray, colorsArray, numPoints);
        } catch (error) {
          console.error('Error parsing point cloud data:', error);
          error.value = 'Error parsing point cloud data';
          isProcessing = false; // Reset the processing flag on error
        }
      };
  
      const updatePointCloud = (positionsArray, colorsArray, numPoints) => {
        try {
          if (maxPoints < numPoints) {
            maxPoints = numPoints;
  
            // Reallocate positions and colors arrays
            positions = new Float32Array(maxPoints * 3);
            geometry.setAttribute(
              'position',
              new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
            );
  
            if (colorsArray) {
              colors = new Float32Array(maxPoints * 3);
              geometry.setAttribute(
                'color',
                new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage)
              );
              material.vertexColors = true;
            } else {
              if (geometry.attributes.color) {
                geometry.deleteAttribute('color');
              }
              material.vertexColors = false;
            }
          }
  
          // Copy data into positions and colors
          positions.set(positionsArray.subarray(0, numPoints * 3));
          geometry.attributes.position.needsUpdate = true;
  
          if (colorsArray) {
            // Convert colors from Uint8 to normalized Float32
            for (let i = 0; i < numPoints * 3; i++) {
              colors[i] = colorsArray[i] / 255.0;
            }
            geometry.attributes.color.needsUpdate = true;
          }
  
          // Update draw range
          geometry.setDrawRange(0, numPoints);
  
          // Update bounding sphere
          geometry.computeBoundingSphere();
  
          // On first update, adjust camera and controls
          if (isFirstUpdate) {
            isFirstUpdate = false;
            fitCameraToObject(pointCloud, 1.5);
          }
        } catch (e) {
          console.error('Error updating point cloud:', e);
          error.value = 'Error updating point cloud';
        } finally {
          // Reset the processing flag after updating
          isProcessing = false;
        }
      };
  
      const fitCameraToObject = (object, offset = 1.25) => {
        // Calculates the optimal camera position to fit the object
        const boundingBox = new THREE.Box3().setFromObject(object);
  
        const center = boundingBox.getCenter(new THREE.Vector3());
        const size = boundingBox.getSize(new THREE.Vector3());
  
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * offset;
  
        // Set camera position
        camera.position.set(center.x, center.y, center.z + cameraZ);
  
        // Set camera to look at the center of the object
        camera.lookAt(center);
  
        // Update controls target
        controls.target.copy(center);
      };
  
      const onWindowResize = () => {
        if (!camera || !renderer || !threeContainer.value) return;
  
        const width = threeContainer.value.clientWidth;
        const height = threeContainer.value.clientHeight;
  
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
  
      // Lifecycle hooks
      onMounted(() => {
        window.addEventListener('resize', onWindowResize);
        initThree();
        connectWebSocket();
      });
  
      onUnmounted(() => {
        isActive = false;
  
        if (websocket) {
          websocket.close();
        }
  
        // Cleanup Three.js resources
        if (geometry) {
          geometry.dispose();
        }
  
        if (material) {
          material.dispose();
        }
  
        if (scene) {
          scene.traverse(object => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach(material => material.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
          scene.dispose();
        }
  
        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss();
        }
  
        if (controls) {
          controls.dispose();
        }
  
        window.removeEventListener('resize', onWindowResize);
      });
  
      return {
        threeContainer,
        error,
        loading,
      };
    },
  };
  </script>
  
  <style scoped>
  .pointcloud-viewer {
    width: 100%;
    height: 100%;
    position: relative;
  }
  
  .three-container {
    width: 100%;
    height: 100%;
  }
  
  .error-message {
    position: absolute;
    top: 10px;
    left: 10px;
    background-color: rgba(255, 0, 0, 0.8);
    color: white;
    padding: 1rem;
    border-radius: 4px;
    text-align: center;
  }
  
  .loading-message {
    position: absolute;
    top: 10px;
    left: 10px;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 1rem;
    border-radius: 4px;
    text-align: center;
  }
  </style>
  