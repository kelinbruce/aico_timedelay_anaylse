/** Browser E2E rationale: verify one safe failure reason and collapsed technical details across real candidate hosts. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-122', async ({ page }) => runBrowserCase('TC-SI-122', page));
