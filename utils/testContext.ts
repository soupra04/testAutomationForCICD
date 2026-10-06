/* 
This module exports a TestContext object to share test state across different test files. 
If there is any specific state that needs to be shared, it can be added here.  
Currently, it contains a flag to skip afterEach logic in tests.
*/

export const TestContext = {
  skipAfterEach: false,
};

