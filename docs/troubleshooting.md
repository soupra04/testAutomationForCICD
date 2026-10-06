# Troubleshooting

## Issues with VSCode

VSCode Playwright extension sometimes fails to register a service worker. It may happen for different reasons in different OS.

### Windows - Cache problem

Clear your Windows Cache. If that doesn't help, easier to restart windows. Search online how to clear cache for code in windows.

### Linux - `code` already has a service worked

Save all your work in VSCode.
Run `killall code` to kill all VSCode related processes.
Restart VSCode.
Reference: [Error loading webview - Could not register service workers](https://stackoverflow.com/questions/67698176/error-loading-webview-error-could-not-register-service-workers-typeerror-fai)
