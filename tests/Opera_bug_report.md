# Weak Registration Implementation: Unverified Accounts Can Disable Security Notifications, Mass-Report Users (Platform Abuse), and Fraudulently Claim Coupons Across Sub-Platforms

## **Description (Easy-Language Summary)**

When you create an account on auth.opera.com, the system sends a verification link to the email address you provided. This is supposed to confirm that you actually own that email address before you can do anything important with your account.

But here's the problem: The system never actually checks whether you clicked that verification link before letting you do things that should require a verified email.

This means an attacker can:

1. Register using any email address in the correct format – a temporary/disposable email, a fake email, or even someone else's real email

2. Never click the verification link

3. Still get full access to:
   * Change security settings (like turning off login alerts)
   * Submit unlimited "Report a Studio" forms and post comments on gx.games
   * Access dev.gx developer tools
   * Access Opera Cashback and actually earn pending cashback rewards
   * Use Opera Sync

The verification email is sent, but it's completely optional. The system trusts you immediately, without ever confirming you are who you say you are.

> **VRT Mapping Note:** Although this is submitted under the 'Weak Registration Implementation' category (to match Bugcrowd's dropdown), the root cause is an Authorization Bypass (Improper Authorization). The registration works correctly; the failure is that the system authorizes unverified users to perform privileged write-actions and financial transactions. I have detailed the systemic access control failures below.

## **Issue & Business Impact**

This is not a minor oversight. The failure to enforce email verification before authorizing sensitive actions creates multiple severe risks for Opera and its users:

### **1. Unlimited Denial-of-Service (DoS) & Platform Abuse**

Since the account never needs to be verified, an attacker can create unlimited accounts using disposable email services.

* Each unverified account can submit "Report a Studio" forms, flag legitimate games/studios, and post spam or toxic comments on gx.games.
* There is no rate limit and no verification check – an attacker could submit hundreds or thousands of fake reports in minutes.

This can overwhelm moderation teams, falsely flag and de-rank legitimate studios, and flood the platform with junk content, severely damaging the community's trust and user experience.

### **2. Silent Account Takeover**

An attacker who registers with a victim's real email can disable "Login Notifications" without any verification.

* If the attacker later compromises that account through other means (credential stuffing, phishing), the victim will never receive an alert about the new login.
* This provides silent, persistent access to the victim's Opera account and all connected services.

### **3. Financial Fraud – Confirmed with Cashback**

I tested this and confirmed it works:

* Using a temporary email address, I created an unverified Opera account.
* I accessed cashback.opera.com with this unverified account.
* I performed actions that generated pending cashback in my account – without ever verifying the email address.
* This means attackers can use disposable email farms to create hundreds of unverified accounts and fraudulently claim cashback rewards, referral bonuses, or promotional coupons.
* Opera loses real money to fraudulent traffic and fake claims. The Cashback platform requires a verified identity to prevent exactly this kind of abuse – and it's completely bypassed.

### **4. Developer Ecosystem Abuse**

* Access to dev.gx without verified identity allows malicious actors to submit faulty code, report fake bugs, or manipulate developer tools, undermining the integrity of Opera's developer community.

### **5. No Rate Limiting = Scalable Attack**

Because the account creation process does not require verification, an attacker can programmatically create thousands of accounts using temporary email APIs.

* Each account can perform all of the above actions indefinitely, with no barrier to entry.

**Summary of Impact:** This vulnerability enables large-scale identity fraud, platform manipulation, financial theft, and silent account persistence.

## **Steps to Reproduce (Proof of Concept)**

Prerequisites: None. No valid email inbox is required. Temporary emails (e.g., TempMail) work perfectly.

### **Phase 1: Registration & Silent Operation**

1. Navigate to https://auth.opera.com/register OR directly to https://gx.games.
2. Enter a temporary email address (e.g., from TempMail) or a validly formatted non-existent email (e.g., test+random123@fakeformat.com).
3. Complete the registration and log in.
   * Observation A: If signing up via sub-platforms directly(gx.games,cashback-opera.com,dev.gx etc), no verification email is sent and the user can use that platform without verification.
   * Observation B: If signing up via auth.opera.com, a link may be sent, but access is NOT restricted without clicking it.
4. Navigate to https://auth.opera.com/profile/security (Security Settings).
5. Action: Turn OFF "Security Notifications" / "Login Alerts".
   * Impact: If this were a real victim's email, they would never receive an alert about this malicious activity.

> **Critical Observation:** When signing up directly through gx.games or cashback.opera.com (instead of auth.opera.com), the system does not even send a verification email at all. The account is considered "active" instantly with zero identity proof.

### **Phase 2: Abuse of Moderation (gx.games)**

1. Navigate to https://gx.games while logged in with the unverified account.
2. Select any game and click the "Report" button.
3. Submit a report (e.g., "Inappropriate Content").
4. Observation: The report is accepted immediately.
5. Scalability: Repeat this process with 10 different temporary emails. All reports are accepted, bypassing per-user rate limits.

### **Phase 3: Financial Fraud (Opera Cashback)**

1. Navigate to https://cashback.opera.com (or the specific cashback portal).
2. Log in with a new temporary email account (unverified).
3. Click on a store offer and attempt to activate/claim the cashback.
4. Observation: The cashback is successfully tracked and appears in the "Pending" state.
   * Impact: An attacker can automate this to drain the marketing budget using infinite temporary emails, as no verification is required to reach "Pending" status.

### **Phase 4: Developer Platform Abuse (dev.gx)**

1. Navigate to https://dev.gx (or the developer portal).
2. Log in with an unverified account.
3. Submit a comment or a bug report.
4. Observation: The submission is accepted without verification.

(Note: Please refer to the attached video demonstrating this exact flow across all domains.)

## **Impact Analysis**

This vulnerability poses a High risk due to the following realistic attack scenarios:

### **1. Direct Financial Loss (Cashback Fraud):**

The ability to claim cashback with temporary/unverified emails allows attackers to bypass "one per user" limits. An attacker can script thousands of claims, directly stealing marketing funds intended for real users. The fact that funds reach "Pending" status confirms the financial transaction logic is triggered without trust verification.

### **2. Denial of Service (DoS) via Mass Reporting:**

An attacker can automate the creation of 1,000+ unverified accounts to mass-report a specific game or developer. Since the system does not verify email ownership, it cannot effectively rate-limit or ban the attacker (they just rotate emails). This can lead to the wrongful delisting of legitimate content and overwhelm the Trust & Safety team.

### **3. Silent Identity Hijacking:**

The ability to disable security notifications on an unverified account is critical. An attacker can register with ceo@opera.com (or any user), disable alerts, and use the account for spam/abuse. The real owner never receives a "New Login" or "Security Change" alert, making detection nearly impossible until significant damage is done.

### **4. Reputation System Bypass:**

The platform's trust score is rendered meaningless because "Unverified" users have the same privileges as "Verified" users for critical actions (Reporting, Claiming Money).

## **Remediation Recommendation**

1. Enforce Verification: Require email_verified = true before allowing access to any write-action (reporting, commenting, claiming cashback/coupons) or security setting changes.
2. Hard Gate for Financial Actions: Specifically for cashback.opera.com, do not allow cashback to reach "Pending" status until the email is verified.
3. Prevent Disabling Alerts: Do not allow security notifications to be disabled until the email address is confirmed.
4. Rate Limiting: Implement strict rate limiting on the registration endpoint and the reporting/coupon-claiming endpoints based on IP and device fingerprint, regardless of email status.