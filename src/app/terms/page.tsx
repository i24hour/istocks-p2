import type { Metadata } from 'next'
import { PolicyPageLayout } from '@/components/PolicyPageLayout'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'Terms & Conditions | iStocks',
    description: 'Terms and conditions for using the iStocks platform and services.',
}

export default function TermsPage() {
    return (
        <PolicyPageLayout title="Terms & Conditions" lastUpdated="25 April 2026">
            <p>
                These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to and use of the iStocks website,
                applications, and related services (collectively, the &quot;Service&quot;) operated by iStocks
                (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). By using the Service, you agree to these
                Terms. If you do not agree, do not use the Service.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">1. Our service</h2>
            <p>
                iStocks provides tools for market data visualisation, paper trading, strategy exploration, and
                AI-assisted analysis. The Service is offered for information and education. We do not provide
                personalised investment advice, and nothing on the Service is a recommendation to buy, sell, or
                hold any security.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">2. Not financial advice</h2>
            <p>
                Markets involve risk. You are solely responsible for your trading and investment decisions. Past
                performance does not guarantee future results. You should consider seeking advice from a qualified
                financial adviser where appropriate.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">3. Your account</h2>
            <p>
                You must provide accurate information when you register. You are responsible for safeguarding your
                account credentials and for all activity under your account. Notify us immediately at{' '}
                <a href="mailto:priyanshu85953@gmail.com" className="text-emerald-400 hover:underline">
                    priyanshu85953@gmail.com
                </a>{' '}
                if you suspect unauthorised use.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">4. Subscriptions and payments</h2>
            <p>
                Where we offer paid plans, fees, billing cycles, and available features are described on the
                pricing and checkout pages. Payments may be processed by third-party payment providers (such as
                Razorpay). You agree to their terms as applicable. See also our{' '}
                <Link href="/refunds" className="text-emerald-400 hover:underline">
                    Refunds &amp; Cancellations
                </Link>{' '}
                page.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">5. Live trading and brokers</h2>
            <p>
                If you connect third-party brokers or place live orders, you remain subject to the broker&apos;s
                own terms, exchange rules, and regulations. iStocks is not a stock broker or a registered
                investment adviser.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">6. AI-generated content</h2>
            <p>
                Outputs from AI features may be incomplete, outdated, or incorrect. You should verify important
                information from primary sources. Do not rely on AI output as the sole basis for any financial
                decision.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">7. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
                <li>use the Service in violation of any law or regulation;</li>
                <li>probe, stress-test, or attack our systems without authorisation;</li>
                <li>scrape or redistribute our data in bulk without permission;</li>
                <li>misrepresent your identity or attempt to access another user&apos;s account.</li>
            </ul>

            <h2 className="text-lg font-semibold text-white pt-2">8. Intellectual property</h2>
            <p>
                The Service, its branding, and its content (excluding your own data) are protected by applicable
                intellectual property laws. You receive a limited, non-exclusive licence to use the Service for
                its intended purpose.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">9. Disclaimers</h2>
            <p>
                The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any
                kind, express or implied, including merchantability, fitness for a particular purpose, and
                non-infringement, to the fullest extent permitted by law.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">10. Limitation of liability</h2>
            <p>
                To the maximum extent permitted by law, we shall not be liable for any indirect, incidental,
                special, consequential, or punitive damages, or any loss of profits or data, arising from your use
                of the Service. Our total liability for any claim relating to the Service shall not exceed the
                amount you paid us for the Service in the twelve (12) months before the event giving rise to the
                claim, or one hundred (100) Indian Rupees if you have not paid, whichever is higher.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">11. Indemnity</h2>
            <p>
                You agree to indemnify and hold harmless iStocks and its operators from any claims, damages, or
                expenses arising from your use of the Service or violation of these Terms, to the extent permitted
                by law.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">12. Governing law</h2>
            <p>
                These Terms are governed by the laws of India, without regard to conflict-of-law rules. Subject to
                applicable law, courts at a venue we designate or as otherwise required by Indian law shall have
                jurisdiction.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">13. Changes</h2>
            <p>
                We may update these Terms from time to time. We will post the new date at the top of this page.
                Continued use of the Service after changes constitutes acceptance of the updated Terms.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">14. Contact</h2>
            <p>
                Questions? See{' '}
                <Link href="/contact" className="text-emerald-400 hover:underline">
                    Contact us
                </Link>
                .
            </p>
        </PolicyPageLayout>
    )
}
