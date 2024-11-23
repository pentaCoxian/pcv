<template>
  <div class="pointcloud-viewer">
    <div ref="threeContainer" class="three-container"></div>
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
    <div v-if="loading" class="loading-message">
      Loading point cloud data...
    </div>
  </div>
</template>

<script>
import { ref, onMounted, nextTick, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as hdf5 from 'h5wasm';

export default {
setup() {
  const threeContainer = ref(null);
  const error = ref(null);
  const loading = ref(false);
  
  // Three.js variables
  let scene, camera, renderer, controls;
  let frames = [];
  let currentFrameIndex = 0;
  let animationId;
  let isActive = true;
  let lastFrameTime = 0;
  const frameDuration = 1000 / 30; // 30fps
 
  // File configuration
  const h5FileUrl = '/out13-v5.h5';
  
  // Hardcoded property names and data types
  const property_names = ['x', 'y', 'z', 'red', 'green', 'blue'];
  const property_dtypes = ['<f4', '<f4', '<f4', '|u1', '|u1', '|u1'];
  
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

      // Initialize camera
      camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 10000);
      camera.position.y = 300;
      camera.position.z = 1000;

      // Initialize renderer
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      // Initialize controls
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.update();

    } catch (err) {
      console.error('Error initializing Three.js:', err);
      error.value = 'Failed to initialize 3D viewer';
    }
  };

  const processH5File = async (arrayBuffer) => {
    let f = null;
    try {
      // Initialize h5wasm
      const Module = await hdf5.ready;
      const { FS } = Module;

      // Write the file to the virtual filesystem
      FS.writeFile("out.h5", new Uint8Array(arrayBuffer));

      // Open the HDF5 file
      f = new hdf5.File("out.h5", "r");

      // Validate file structure
      const frames_group = f.get('frames');
      if (!frames_group) {
        throw new Error("Missing 'frames' group in file");
      }

      // Get frame names
      let frame_names = frames_group.keys();

      // Sort frame names numerically if they contain numbers
      frame_names.sort((a, b) => {
        const aNum = parseInt(a.match(/\d+/)[0]);
        const bNum = parseInt(b.match(/\d+/)[0]);
        return aNum - bNum;
      });

      // Initialize Three.js after we confirm we have valid data
      await nextTick();
      initThree();

      // Clear existing frames
      frames.forEach(pointCloud => {
        if (pointCloud.geometry) pointCloud.geometry.dispose();
        if (pointCloud.material) pointCloud.material.dispose();
      });
      frames = [];
      currentFrameIndex = 0;

      // Process each frame
      for (const frame_name of frame_names) {
        const frame_dataset = frames_group.get(frame_name);
        const data = await frame_dataset.to_array();

        if (!Array.isArray(data) || !data.length) {
          console.warn(`Skipping invalid frame: ${frame_name}`);
          continue;
        }

        const num_points = data.length;
        const num_properties = property_names.length;

        // Create properties object
        const properties = {};
        for (let i = 0; i < property_names.length; i++) {
          properties[property_names[i]] = new Array(num_points);
        }

        for (let i = 0; i < num_points; i++) {
          const row = data[i];
          for (let j = 0; j < num_properties; j++) {
            properties[property_names[j]][i] = row[j];
          }
        }

        // Create geometry
        const geometry = new THREE.BufferGeometry();

        // Set positions
        const positions = new Float32Array(num_points * 3);
        const x = properties['x'];
        const y = properties['y'];
        const z = properties['z'];

        for (let i = 0; i < num_points; i++) {
          positions[i * 3] = x[i];
          positions[i * 3 + 1] = y[i];
          positions[i * 3 + 2] = z[i];
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Handle colors if present
        const hasRGB = property_names.includes('red') && 
                       property_names.includes('green') && 
                       property_names.includes('blue');

        let material;
        if (hasRGB) {
          const colors = new Uint8Array(num_points * 3);
          const red = properties['red'];
          const green = properties['green'];
          const blue = properties['blue'];
          
          for (let i = 0; i < num_points; i++) {
            colors[i * 3] = red[i];
            colors[i * 3 + 1] = green[i];
            colors[i * 3 + 2] = blue[i];
          }
          
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
          material = new THREE.PointsMaterial({ 
            vertexColors: true, 
            size: 0.1,
            sizeAttenuation: true
          });
        } else {
          material = new THREE.PointsMaterial({ 
            color: 0xffffff, 
            size: 0.1,
            sizeAttenuation: true
          });
        }

        const pointCloud = new THREE.Points(geometry, material);
        frames.push(pointCloud);
      }

      if (frames.length > 0) {
        error.value = null;
        animate();
      } else {
        throw new Error("No valid frames found in file");
      }

    } catch (err) {
      console.error('Error processing HDF5 file:', err);
      error.value = `Failed to process point cloud data: ${err.message}`;
    } finally {
      if (f) {
        try {
          f.close();
        } catch (err) {
          console.warn('Error closing HDF5 file:', err);
        }
      }
      loading.value = false;
    }
  };

  const fetchAndProcessH5File = async () => {
    loading.value = true;
    error.value = null;
    
    try {
      const response = await fetch(h5FileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      await processH5File(arrayBuffer);
    } catch (err) {
      console.error('Error fetching H5 file:', err);
      error.value = `Failed to load point cloud file: ${err.message}`;
      loading.value = false;
    }
  };

  const animate = (time) => {
    if (!isActive) return;

    if (!lastFrameTime) {
      lastFrameTime = time;
    }
    const delta = time - lastFrameTime;

    // Update frame index based on time
    if (delta >= frameDuration) {
      currentFrameIndex = (currentFrameIndex + 1) % frames.length;
      lastFrameTime = time;
    }

    // Remove previous point cloud
    scene.clear();

    // Add current frame
    scene.add(frames[currentFrameIndex]);

    // Update controls
    controls.update();

    // Render
    renderer.render(scene, camera);

    // Schedule next frame
    animationId = requestAnimationFrame(animate);
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
  onMounted(async () => {
    window.addEventListener('resize', onWindowResize);
    await fetchAndProcessH5File();
  });

  onUnmounted(() => {
    isActive = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
    }

    // Cleanup Three.js resources
    frames.forEach(pointCloud => {
      if (pointCloud.geometry) pointCloud.geometry.dispose();
      if (pointCloud.material) pointCloud.material.dispose();
    });

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
      renderer.domElement?.remove();
    }

    if (controls) {
      controls.dispose();
    }

    window.removeEventListener('resize', onWindowResize);
  });

  return {
    threeContainer,
    error,
    loading
  };
}
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
height: 1200px;
}

.error-message {
position: absolute;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background-color: rgba(255, 0, 0, 0.8);
color: white;
padding: 1rem;
border-radius: 4px;
text-align: center;
}

.loading-message {
position: absolute;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background-color: rgba(0, 0, 0, 0.8);
color: white;
padding: 1rem;
border-radius: 4px;
text-align: center;
}
</style>
