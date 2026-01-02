/**
 * Matcher registration for test setup.
 *
 * This file imports state-mock.ts which auto-registers base matchers (toBeUnchanged).
 * Future mock-specific matchers should be imported and extended here.
 */

// Register base matchers for MockWithState
import "./state-mock";

// Future mock-specific matchers:
// import { fileSystemMatchers } from "../services/platform/file-system.state-mock";
// expect.extend({ ...fileSystemMatchers });
