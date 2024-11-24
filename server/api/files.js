import fs from 'fs';
import path from 'path';

// Import utilities from 'h3' for handling events and errors
import { defineEventHandler, createError } from 'h3';

// Define the event handler for the API route
export default defineEventHandler((event) => {
  const publicFolder = path.join(process.cwd(), 'public');

  try {
    const files = fs.readdirSync(publicFolder);
    const h5Files = files.filter((file) => path.extname(file).toLowerCase() === '.h5');

    // Return the list of .h5 files as JSON
    return { files: h5Files };
  } catch (err) {
    console.error('Error reading public folder:', err);

    // Throw an error to be handled by Nuxt's error handling
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to read public folder',
      data: {
        error: 'Failed to read public folder',
      },
    });
  }
});