export const HYPERSWITCH_PROVIDERS = [
  { id: 'razorpay', label: 'Razorpay', region: 'India & South Asia', keyLabel: 'Key ID', secretLabel: 'Key Secret', defaultCurrencies: ['INR'] },
  { id: 'cashfree', label: 'Cashfree', region: 'India & South Asia', keyLabel: 'App ID', secretLabel: 'Secret Key', defaultCurrencies: ['INR'] },
  { id: 'payu', label: 'PayU', region: 'India & South Asia', keyLabel: 'Merchant Key', secretLabel: 'Merchant Salt', defaultCurrencies: ['INR'] },
  { id: 'phonepe', label: 'PhonePe', region: 'India & South Asia', keyLabel: 'Merchant ID', secretLabel: 'Salt Key', defaultCurrencies: ['INR'] },
  { id: 'billdesk', label: 'BillDesk', region: 'India & South Asia', keyLabel: 'Merchant ID', secretLabel: 'Security Key', defaultCurrencies: ['INR'] },
  { id: 'stripe', label: 'Stripe', region: 'Global & North America', keyLabel: 'Publishable Key', secretLabel: 'Secret Key', defaultCurrencies: ['USD', 'EUR', 'GBP', 'AUD', 'INR'] },
  { id: 'paypal', label: 'PayPal', region: 'Global & North America', keyLabel: 'Client ID', secretLabel: 'Client Secret', defaultCurrencies: ['USD', 'EUR', 'GBP', 'AUD'] },
  { id: 'adyen', label: 'Adyen', region: 'Global & North America', keyLabel: 'Merchant Account', secretLabel: 'API Key', defaultCurrencies: ['USD', 'EUR', 'GBP'] },
  { id: 'braintree', label: 'Braintree', region: 'Global & North America', keyLabel: 'Merchant ID / Public Key', secretLabel: 'Private Key', defaultCurrencies: ['USD', 'EUR'] },
  { id: 'authorizedotnet', label: 'Authorize.Net', region: 'Global & North America', keyLabel: 'API Login ID', secretLabel: 'Transaction Key', defaultCurrencies: ['USD', 'CAD'] },
  { id: 'cybersource', label: 'CyberSource', region: 'Global & North America', keyLabel: 'Merchant ID', secretLabel: 'Transaction Key', defaultCurrencies: ['USD'] },
  { id: 'checkout', label: 'Checkout.com', region: 'Global & North America', keyLabel: 'Public Key', secretLabel: 'Secret Key', defaultCurrencies: ['USD', 'EUR', 'GBP'] },
  { id: 'mollie', label: 'Mollie', region: 'Europe', keyLabel: 'Profile ID', secretLabel: 'API Key', defaultCurrencies: ['EUR'] },
  { id: 'klarna', label: 'Klarna', region: 'Europe', keyLabel: 'UID', secretLabel: 'Password', defaultCurrencies: ['EUR', 'GBP', 'USD'] },
  { id: 'airwallex', label: 'Airwallex', region: 'APAC & Middle East', keyLabel: 'Client ID', secretLabel: 'API Key', defaultCurrencies: ['USD', 'AUD', 'HKD', 'SGD'] },
  { id: 'dlocal', label: 'dLocal', region: 'APAC & Middle East', keyLabel: 'x-login', secretLabel: 'x-trans-key', defaultCurrencies: ['USD'] },
] as const;
export type HyperswitchProviderId = (typeof HYPERSWITCH_PROVIDERS)[number]['id'] | (string & {});
