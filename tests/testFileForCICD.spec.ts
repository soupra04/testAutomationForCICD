import { test, expect } from '@playwright/test';

test.describe('Test File for CICD', () => {

    test('checkboxes toggle', async ({ page }) => {

        await page.goto("https://the-internet.herokuapp.com/checkboxes");
        const checkboxes = page.getByRole('checkbox');
        if (!(await checkboxes.nth(0).isChecked())) {
            checkboxes.nth(0).uncheck();
    
        } else {
            checkboxes.nth(0).check();
        }
    });
    
    test('drag and drop columns', async ({ page }) => {
    
        await page.goto("https://the-internet.herokuapp.com/drag_and_drop");
        const pointA = page.locator('#column-a');
        const pointB = page.locator('#column-b');
        // await pointA.dragTo(pointB);
    
        //manually drag and drop 
    
        await pointA.hover();
        await page.mouse.down();
        await pointB.hover();
        await page.mouse.up();
    
    
    
    
    
    });
    
    test('dropdown select option', async ({ page }) => {
    
        await page.goto("https://the-internet.herokuapp.com/dropdown");
    
        const drp = page.locator('#dropdown');
        //await drp.selectOption('Option 1'); //selectoption by value
        await drp.selectOption({ label: 'Option 1' }); //select by label
    
    
    });


});