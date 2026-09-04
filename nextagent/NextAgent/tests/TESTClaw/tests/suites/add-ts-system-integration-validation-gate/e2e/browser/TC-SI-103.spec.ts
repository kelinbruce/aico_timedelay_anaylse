/** Browser E2E rationale: exercise TC-SI-103 against a real packed candidate without route interception. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-103', async ({ page }) => runBrowserCase('TC-SI-103', page));
