#!/usr/bin/env node
import { createPluginScaffold } from './index.js';

const targetDirectory = process.argv[2];
if (targetDirectory === undefined || targetDirectory.trim() === '') {
  console.error('Usage: create-nextagent-plugin <plugin-directory>');
  process.exitCode = 1;
} else {
  try {
    const result = createPluginScaffold({ targetDirectory });
    console.log(`Created ${result.pluginId} plugin scaffold.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Plugin scaffold failed.');
    process.exitCode = 1;
  }
}
