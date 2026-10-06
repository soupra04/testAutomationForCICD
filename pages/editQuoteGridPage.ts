import { Page } from "@playwright/test";

// Initialising all the locators used on Edit Quote Grid tests
export const selectAllButtonLocator = "btnselAllRows";
export const deleteButtonLocator = "btndelQuoteItems";
export const untieButtonLocator = "btnuntieBoxes";
export const cloneBoxesButtonLocator = "btncloneBoxes";
export const setGroupingButtonLocator = "btnsetGrouping";
export const goToQuoteChevronName = "Go To Quote";
export const goToCopyBoMItems = "Copy BoM Items";
export const goToSelectBomsChevronName = "Select BoMs";
export const goToEditQuoteGridChevronName = "Edit";
export const goToCopyMasterItemsChevronName = "Copy Master Items";

export class EditQuoteGridPage {
    constructor(private page: Page) {}
    // ToDo: will make methods if required
}