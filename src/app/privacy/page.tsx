import type { Metadata } from 'next'
import { PolicyPageLayout } from '@/components/PolicyPageLayout'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'Privacy Policy | iStocks',
    description: 'How iStocks collects, uses, and protects your personal information.',
}

export default function PrivacyPage() {
    return (
        <PolicyPageLayout title="Privacy Policy" lastUpdated="26 April 2026">
            <p>
                This Privacy Policy explains how iStocks (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects,
                uses, stores, and protects information when you use our website, applications, and related services
                (the &quot;Service&quot;). By using the Service, you agree to this policy. If you do not agree,
                please do not use the Service.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">1. Who we are</h2>
            <p>
                iStocks operates the Service. For privacy-related questions, contact us via the details on our{' '}
                <Link href="/contact" className="text-emerald-400 hover:underline">
                    Contact us
                </Link>{' '}
                page.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">2. Information we collect</h2>
            <p>We may collect the following types of information, depending on how you use the Service:</p>
            <ul className="list-disc pl-5 space-y-2">
                <li>
                    <strong className="text-gray-200">Account data:</strong> such as name, email address, and
                    credentials when you register or sign in (including via third-party login providers where
                    enabled).
                </li>
                <li>
                    <strong className="text-gray-200">Profile &amp; usage:</strong> preferences, settings, and
                    interactions with features (for example, saved strategies, chat sessions, or trading-related
                    preferences).
                </li>
                <li>
                    <strong className="text-gray-200">Payment-related data:</strong> when you subscribe to a paid
                    plan, our payment partner (for example, Razorpay) processes payments. We may store limited
                    records such as subscription status, order or payment identifiers, and a mobile number you
                    provide for checkout — we do not store full card or UPI PIN data on our servers.
                </li>
                <li>
                    <strong className="text-gray-200">Technical data:</strong> IP address, device and browser type,
                    approximate location derived from IP, and cookies or similar technologies where we use them for
                    security or essential functionality.
                </li>
            </ul>

            <h2 className="text-lg font-semibold text-white pt-2">3. How we use your information</h2>
            <p>We use information to:</p>
            <ul className="list-disc pl-5 space-y-2">
                <li>Provide, operate, and improve the Service;</li>
                <li>Authenticate you and secure your account;</li>
                <li>Process subscriptions and communicate about billing where applicable;</li>
                <li>Respond to support requests and comply with legal obligations;</li>
                <li>Detect, prevent, and address fraud, abuse, or technical issues.</li>
            </ul>

            <h2 className="text-lg font-semibold text-white pt-2">4. Legal basis (where applicable)</h2>
            <p>
                If data protection law requires a legal basis, we rely on performance of a contract (providing the
                Service), legitimate interests (such as security and improvement of the Service, balanced against
                your rights), and consent where we ask for it explicitly.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">5. Sharing with third parties</h2>
            <p>
                We do not sell your personal information. We may share data with service providers who help us run
                the Service, such as hosting, email delivery, analytics, authentication, or payment processing. These
                providers are permitted to use your information only as needed to perform services for us and in line
                with applicable law. We may also disclose information if required by law or to protect our rights and
                users&apos; safety.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">6. Retention</h2>
            <p>
                We keep your information for as long as your account is active or as needed to provide the Service,
                comply with legal obligations, resolve disputes, and enforce our agreements. Retention periods may
                vary by data type.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">7. Security</h2>
            <p>
                We implement reasonable technical and organisational measures to protect your information. No method
                of transmission over the Internet is 100% secure; we cannot guarantee absolute security.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">8. Your choices and rights</h2>
            <p>
                Depending on your location, you may have rights to access, correct, delete, or restrict certain
                processing of your personal data, or to object to processing. To exercise these rights, contact us
                via{' '}
                <Link href="/contact" className="text-emerald-400 hover:underline">
                    Contact us
                </Link>
                . We may need to verify your identity before responding.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">9. Children</h2>
            <p>
                The Service is not directed at children under 16 (or the minimum age in your jurisdiction). We do not
                knowingly collect personal information from children. If you believe we have, please contact us so we
                can delete it.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">10. International transfers</h2>
            <p>
                Our servers or service providers may be located outside your country. Where we transfer data across
                borders, we take steps consistent with applicable law.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">11. Changes to this policy</h2>
            <p>
                We may update this Privacy Policy from time to time. We will post the updated version on this page
                and adjust the &quot;Last updated&quot; date. Continued use of the Service after changes constitutes
                acceptance of the updated policy where permitted by law.
            </p>

            <h2 className="text-lg font-semibold text-white pt-2">12. Related documents</h2>
            <p>
                See also our{' '}
                <Link href="/terms" className="text-emerald-400 hover:underline">
                    Terms &amp; Conditions
                </Link>{' '}
                and{' '}
                <Link href="/refunds" className="text-emerald-400 hover:underline">
                    Refunds &amp; Cancellations
                </Link>
                .
            </p>
        </PolicyPageLayout>
    )
}
