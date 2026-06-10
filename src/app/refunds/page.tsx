import type { Metadata } from 'next'
import { PolicyPageLayout } from '@/components/PolicyPageLayout'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'Refunds & Cancellations | iStocks',
    description: 'Refund and cancellation policy for iStocks subscriptions and payments.',
}

export default function RefundsPage() {
    return (
        <PolicyPageLayout title="Refunds & Cancellations" lastUpdated="25 April 2026">
            <p>
                This policy describes how subscription payments, refunds, and cancellations work for paid plans
                on iStocks. It applies in addition to our{' '}
                <Link href="/terms" className="text-emerald-400 hover:underline">
                    Terms &amp; Conditions
                </Link>
                .
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">1. What you are paying for</h2>
            <p>
                Paid plans (for example, Pro) unlock features such as higher limits and AI model access as described
                on the pricing page at the time of purchase. Features may evolve; material reductions will be
                communicated where reasonably practicable.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">2. How payments are processed</h2>
            <p>
                Payments are processed by regulated payment partners (for example, Razorpay). Your bank or
                card statement may show the payment provider or iStocks as the descriptor. You agree to the payment
                provider&apos;s own terms and privacy practices for the payment step.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">3. Cancellations</h2>
            <p>
                <strong>Before payment:</strong> you can leave the payment screen at any time; no charge is made
                until you complete the payment.
            </p>
            <p>
                <strong>After purchase:</strong> if your product includes a recurring subscription, you may
                cancel renewal before the next billing date through the same channel you used to subscribe, or by
                contacting us at{' '}
                <a href="mailto:priyanshu85953@gmail.com" className="text-emerald-400 hover:underline">
                    priyanshu85953@gmail.com
                </a>
                . Cancellation stops future charges; it does not automatically refund amounts already paid unless
                required by this policy or applicable law.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">4. Refunds (general)</h2>
            <p>We want users to be treated fairly. Refund requests are reviewed case by case, subject to the rules below.</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
                <li>
                    <strong>Duplicate charge:</strong> if you were charged twice for the same order, we will
                    correct this after verification (refund of the duplicate or adjustment as appropriate).
                </li>
                <li>
                    <strong>Service not delivered:</strong> if you paid and Pro access was not granted due to a
                    confirmed system error on our side, we will either restore access or offer a refund for that
                    payment, at our reasonable discretion.
                </li>
                <li>
                    <strong>Change of mind / dissatisfaction:</strong> digital subscriptions may not be refundable
                    once access has been granted, except where required by law or as we may allow in a specific
                    promotion. You may still cancel future renewals as above.
                </li>
            </ul>

            <h2 className="text-lg font-semibold text-white pt-2">5. How to request a refund</h2>
            <p>
                Email{' '}
                <a href="mailto:priyanshu85953@gmail.com" className="text-emerald-400 hover:underline">
                    priyanshu85953@gmail.com
                </a>{' '}
                with your registered iStocks email, order or transaction reference, date of payment, and a short
                description. We will confirm receipt and may ask for additional information to verify the payment.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">6. Timing of refunds</h2>
            <p>
                Approved refunds are typically initiated within 5–7 business days. The amount may take additional
                time to appear on your card or bank statement, depending on your bank or card issuer.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">7. Disputes and chargebacks</h2>
            <p>
                If you file a chargeback, your bank or card network will apply its own process. We will provide
                evidence of delivery where applicable. Please contact us first so we can resolve issues without
                unnecessary disputes.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">8. Contact</h2>
            <p>
                <Link href="/contact" className="text-emerald-400 hover:underline">
                    Contact us
                </Link>{' '}
                for questions about this policy.
            </p>
        </PolicyPageLayout>
    )
}
