// ExtensionPay content script, injected only on extensionpay.com. It runs at
// document_start and simply constructing ExtPay with our id lets ExtensionPay's
// page complete the checkout/login handshake with this extension. No email data
// is ever in scope here.
import ExtPay from 'extpay';
import { EXTPAY_ID } from '@/lib/license';

ExtPay(EXTPAY_ID);
