UPDATE organization_currency_settings
SET supported_currencies = ARRAY['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD']::text[],
    default_currency = 'INR',
    updated_at = now()
WHERE supported_currencies = ARRAY['INR']::text[];
