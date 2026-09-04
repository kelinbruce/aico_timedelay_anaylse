/** Browser E2E rationale: verify process output handoff through a real candidate final-answer projection. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-121', async ({ page }) => runBrowserCase('TC-SI-121', page));
