/** Browser E2E rationale: verify pending tool-round output through a real candidate process bridge. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-120', async ({ page }) => runBrowserCase('TC-SI-120', page));
