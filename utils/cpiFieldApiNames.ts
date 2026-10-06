import { getSfOrgPrefix } from './cpiOrg';

/**
 * CPI Salesforce custom field API suffixes (without namespace prefix).
 * Full API name = `{SF_ORG_PREFIX}__{suffix}` (e.g. StrataVAR__CPI_Total_Amount__c).
 */
export const CPI_QUOTE_FIELD_SUFFIX = {
  totalAmount: 'CPI_Total_Amount__c',
  totalBaseLand: 'CPI_Total_Base_Land_Amount__c',
  totalAccelerator: 'CPI_Total_Accelerator_Amount__c',
  rebateStatus: 'CPI_Rebate_Status__c',
  effectiveDate: 'CPI_Effective_Date__c',
} as const;

export const CPI_QUOTE_ITEM_FIELD_SUFFIX = {
  totalAmount: 'Total_CPI_Amount__c',
  baseLandAmount: 'CPI_Base_Land_Amount__c',
  acceleratorAmount: 'CPI_Accelerator_Amount__c',
  calculationStatus: 'CPI_Calculation_Status__c',
  selectedPortfolio: 'CPI_Selected_Portfolio__c',
  pviTier: 'CPI_PVI_Tier__c',
  baseRebatePercentage: 'CPI_Base_Rebate_Percentage__c',
  acceleratorRebatePercentage: 'CPI_Accelerator_Rebate_Percentage__c',
  specBonusAmount: 'CPI_Spec_Bonus_Amount__c',
  specBonusPercentage: 'CPI_Spec_Bonus_Percentage__c',
} as const;

export type CpiQuoteFieldKey = keyof typeof CPI_QUOTE_FIELD_SUFFIX;
export type CpiQuoteItemFieldKey = keyof typeof CPI_QUOTE_ITEM_FIELD_SUFFIX;

/** Namespace prefix from SF_ORG_PREFIX (configurable per org). */
export function cpiNamespacePrefix(prefix?: string): string {
  return (prefix ?? getSfOrgPrefix()).trim();
}

/** Build a namespaced CPI field API name: `{prefix}__{suffix}`. */
export function cpiFieldApi(suffix: string, prefix?: string): string {
  return `${cpiNamespacePrefix(prefix)}__${suffix}`;
}

export function cpiQuoteField(key: CpiQuoteFieldKey, prefix?: string): string {
  return cpiFieldApi(CPI_QUOTE_FIELD_SUFFIX[key], prefix);
}

export function cpiQuoteItemField(key: CpiQuoteItemFieldKey, prefix?: string): string {
  return cpiFieldApi(CPI_QUOTE_ITEM_FIELD_SUFFIX[key], prefix);
}

/** Standard object API names with configurable namespace. */
export function cpiQuoteObjectApi(prefix?: string): string {
  return cpiFieldApi('CustomerBoM__c', prefix);
}

export function cpiQuoteItemObjectApi(prefix?: string): string {
  return cpiFieldApi('Cust_BoM_Item__c', prefix);
}

export function cpiCustomerBoMLookupField(prefix?: string): string {
  return cpiFieldApi('CustomerBoM__c', prefix);
}
