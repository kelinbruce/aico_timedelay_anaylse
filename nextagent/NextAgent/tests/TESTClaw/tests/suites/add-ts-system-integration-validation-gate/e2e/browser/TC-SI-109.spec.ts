/** Browser E2E rationale: exercise TC-SI-109 against a real packed candidate without route interception. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-109', async ({ page }) => runBrowserCase('TC-SI-109', page));
