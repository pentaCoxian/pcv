import { defineNuxtPlugin } from '#app'; // Import defineNuxtPlugin
import * as THREE from 'three';

export default defineNuxtPlugin((nuxtApp) => {
  // Provide THREE globally
  nuxtApp.provide('THREE', THREE);
});