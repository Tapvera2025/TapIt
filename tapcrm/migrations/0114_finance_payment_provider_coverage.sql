-- 0114 — Allow every provider supported by the provider-neutral Hyperswitch
-- adapter to flow through the receipt lifecycle.
ALTER TABLE payment_receipt DROP CONSTRAINT IF EXISTS payment_receipt_provider_check;
ALTER TABLE payment_receipt ADD CONSTRAINT payment_receipt_provider_check
  CHECK (provider IN (
    'razorpay','stripe','cashfree','paypal','payu','phonepe','billdesk',
    'adyen','braintree','authorizedotnet','cybersource','checkout','mollie',
    'klarna','airwallex','dlocal','bank_transfer','cash','cheque','manual'
  ));
