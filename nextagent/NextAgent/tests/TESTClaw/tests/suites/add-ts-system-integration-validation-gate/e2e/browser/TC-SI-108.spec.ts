/** Browser E2E rationale: exercise TC-SI-108 against a real packed candidate without route interception. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-108', async ({ page }) => runBrowserCase('TC-SI-108', page));
