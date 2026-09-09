PRODUCT REQUIREMENTS DOCUMENT (PRD)

Project Name: Classroom Copier Document Version: 1.1 Target Audience: Engineering Team / AI Coding Agents

1. EXECUTIVE SUMMARY AND VISION Classroom Copier is a lightweight, high-performance web application that enables teachers to batch-copy Classwork topics, assignments, materials, and quizzes from any source Google Classroom to any target Google Classroom—without duplicating files in Google Drive or creating administrative clutter.  
2. CORE PROBLEM STATEMENTS AND SOLUTIONS

Problem 1: The SIS/Roster Sync Lockout

* Context: District IT departments regularly auto-generate empty Google Classroom shells pre-populated with student rosters synced from the district's Student Information System (SIS).  
* Pain Point: Google's native "Copy Class" feature creates a new un-synced course shell, meaning teachers cannot use native copying on their IT-assigned roster shells.  
* Solution: Classroom Copier allows teachers to push coursework into any existing destination course, including IT-created roster shells.

Problem 2: The Google Drive "Duplicate File" Nightmare

* Context: Google's native "Copy Class" tool creates brand-new file copies (e.g., "Copy of Unit 1 Slides") inside Google Drive for every assignment attachment.  
* Pain Point: Clutters Google Drive with hundreds of duplicate files, breaks master template links, and forces teachers to clean up Drive manually.  
* Solution: Classroom Copier attaches existing original Google Drive file links directly to target classwork. One master file, zero duplicates.

Problem 3: The "Reuse Post" Friction

* Context: Google Classroom's native "Reuse Post" feature keeps original file links, but forces teachers to copy posts individually.  
* Pain Point: Copying a full year of 50+ assignments takes hours of tedious manual clicks.  
* Solution: Classroom Copier batch-transfers an entire semester or year of coursework in seconds with one click.  
3. PRODUCT ARCHITECTURE AND EXECUTION RULES

Rule A: Topic Infrastructure and ID Mapping First

* Fetch all source topics and create corresponding topics in the target class.  
* Maintain a dynamic Key-Value Map of Old Topic ID to New Topic ID to accurately assign posts to their new unit topics upon creation.

Rule B: Scope and Filtering

* Included Scope: Classwork posts ONLY (Assignments, Quiz Assignments, Questions, Materials), regardless of source state (Draft, Published, or Scheduled).  
* Excluded Scope:  
  * Stream announcements  
  * Student submissions, turn-in statuses, or student files  
  * Class comments, private comments, and grades  
  * Course-level settings (Google Meet links, grading categories)

Rule C: Post Transformation Rules When copied into the destination course:

1. State: Save all transferred posts as Drafts.  
2. Timing: Clear all due dates and scheduled posting times.  
3. Preservation: Retain titles, instructions, max points, and topic assignments.  
4. Audience: Default target audience to "All Students."  
5. Ordering: Transfer posts in reverse chronological order (oldest post first, newest post last) so the target topic feed maintains correct chronological ordering.

Rule D: Master File and Permission Preservation Protocol

* Direct-link all original Google Drive files (Docs, Slides, Sheets, PDFs, Forms) using their existing Drive file IDs.  
* Preserve shareMode Permission: Explicitly copy the shareMode parameter from the source attachment (VIEW, EDIT, or STUDENT\_COPY). Do NOT default to VIEW.  
* Attachment Types: Correctly map materials into driveFile, youtubeVideo, or link objects.  
* Attachment Limit Handling: Enforce Google's max 20 attachment limit per post. Attachments 21+ are appended as URL links inside the post description text.

Rule E: Fail-Safe Transfer and Graceful Fallbacks

* Execution Boundary: Built on a Node.js/Express backend to bypass Google Apps Script's 6-minute execution limit.  
* Rate-Limit Handling: Implement exponential backoff for Google API calls to handle HTTP 429 (Rate Limit Exceeded) gracefully.  
* Rubric Graceful Degradation: Attempt rubric copying via API (courses.courseWork.rubrics). If blocked by Google Workspace license tier restrictions (e.g. standard vs Education Plus), create the post and append a note detailing the uncopied rubric.  
* Guaranteed Draft Shell Creation: If an attachment fails API verification (e.g., missing file, deleted file, network hiccup), the system MUST still create the assignment shell in Google Classroom.  
* Fallback Text Injection: Append a clear note to the end of the assignment description if an attachment cannot be linked: "\[Classroom Copier Note: Original attachment 'Unit\_1\_Quiz.pdf' could not be linked due to a permission error or deleted file.\]"  
4. PRE-FLIGHT HEALTH CHECK ENGINE

The Pre-Flight Health Check runs automatically after class selection. It remains silent by default unless actual file errors are detected.

Scenario 1: Normal Operation

* Detection: All source attachments are accessible and healthy.  
* Behavior: Auto-link master Drive files and Google Forms directly. Bypass modal.

Scenario 2: Trashed or Deleted Drive Files

* Detection: Source post links to a file currently in Google Drive Trash or deleted.  
* Behavior: Create assignment draft shell with fallback text note. Prompt user with options: \[Create Draft Shell with Note\] OR \[Skip Assignment\].

Scenario 3: Permission Lock / Co-Teacher Files

* Detection: File is owned by a former co-teacher or restricted account (View Only).  
* Behavior: Flag potential loss of access if the account is deactivated. Prompt user with options: \[Copy to My Drive (Become Owner)\] OR \[Link Existing File (Risk Warning)\] OR \[Skip Attachment and Note Draft\].  
5. USER WORKFLOW AND UI SPECIFICATIONS

Workflow Sequence: Step 1: Sign In Step 2: Select Source and Target Step 3: Pre-Flight Scan Step 4: Batch Transfer Engine (or Action Sheet Modal if errors detected) Step 5: Itemized Summary Report

Section 1: Source and Target Selection

* OAuth Parameter: Force prompt=select\_account on login to avoid multi-Google account collisions.  
* Source Course Selector: Dropdown displaying active AND archived courses where the user is listed as a teacher.  
* Destination Course Selector: Dropdown displaying active courses where the user is listed as a teacher (including IT/SIS roster shells).

Section 2: Pre-Flight Action Sheet Modal (Conditional)

* Renders only when deleted or permission-locked files are detected.  
* Displays a global toggle: Apply recommended fixes automatically.

Section 3: Completion Summary Report Upon completion, present a modal showing:

* Total topics created / mapped  
* Total draft assignments successfully transferred  
* Count of posts created as fallback shells due to attachment errors (with detailed log)  
6. TECHNICAL STACK AND API SCOPES

Tech Stack:

* Frontend: React / Tailwind CSS  
* Backend: Node.js / Express (Serverless or Containerized)  
* API Integration: Google Classroom API, Google Drive API

Required Google OAuth Scopes:

* [https://www.googleapis.com/auth/classroom.courses.readonly](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.courses.readonly)  
* [https://www.googleapis.com/auth/classroom.coursework.students](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.coursework.students)  
* [https://www.googleapis.com/auth/classroom.topics](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.topics)  
* [https://www.googleapis.com/auth/drive.readonly](https://www.google.com/search?q=https://www.googleapis.com/auth/drive.readonly) (or drive.file for permission fixes)  
7. MONETIZATION AND GROWTH ARCHITECTURE  
8. Launch Stage: 100% Free with unlimited batch transfers.  
9. Paywall Integration Hooks: Embed credit balance checks and user subscription status objects into backend route middleware for future activation (e.g., via Stripe).  
10. Credit Deduction Rule: Deduct user credits only when 100% of posts and attachments transfer without error fallback injections. Partial or fallback transfers refund the credit automatically.

DEPLOYMENT & HOSTING GUIDE: RENDER \+ GOOGLE OAUTH

1. PLATFORM RATIONALE & ARCHITECTURE NOTE

Why Render is the Selected Host:

* Unified Free Hosting: Render supports both a Node.js/Express backend service and a React static frontend under a single dashboard at $0/month.  
* Long-Running API Requests: Unlike serverless providers (e.g., Vercel or Netlify) that enforce strict 10-second request timeouts, Render hosts a standard Express server. This allows batch transfers of 50+ assignments and Google Classroom API calls to process without timing out mid-transfer.  
* Continuous Deployment: Connects directly to GitHub for automatic builds on git push.

Critical Technical Note (Free Tier Cold Starts):

* Render's free web services automatically go to sleep after 15 minutes of inactivity.  
* The first API request after a period of inactivity may take 30 to 50 seconds while the server wakes up.  
* Developer Action: Ensure the frontend implements a clean loading spinner or health-check ping ("Waking up server...") so users understand the brief initial delay upon first sign-in.  
2. GOOGLE OAUTH & GOOGLE API CONSOLE SETUP

Step 1: Create a Project in Google Cloud Console

* Go to [https://console.cloud.google.com/](https://console.cloud.google.com/) and create a new project (e.g., "Classroom-Copier-Production").

Step 2: Enable Required APIs Navigate to APIs & Services \> Library and enable:

* Google Classroom API  
* Google Drive API

Step 3: Configure the OAuth Consent Screen

* Select User Type: External (or Internal if restricted strictly to a single school domain).  
* Fill in required App Info and Support Email.  
* Add the required Scopes:  
  * [https://www.googleapis.com/auth/classroom.courses.readonly](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.courses.readonly)  
  * [https://www.googleapis.com/auth/classroom.coursework.students](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.coursework.students)  
  * [https://www.googleapis.com/auth/classroom.topics](https://www.google.com/search?q=https://www.googleapis.com/auth/classroom.topics)  
  * [https://www.googleapis.com/auth/drive.readonly](https://www.google.com/search?q=https://www.googleapis.com/auth/drive.readonly) (or drive.file)  
* Add Test Users (your email and beta tester emails) if the publishing status is set to Testing.

Step 4: Create OAuth 2.0 Credentials

* Go to APIs & Services \> Credentials \> Create Credentials \> OAuth client ID.  
* Application Type: Web application.  
* Authorized JavaScript origins:  
  * Local Dev: [http://localhost:5173](http://localhost:5173/) (or your local port)  
  * Production: [https://your-app-frontend.onrender.com](https://www.google.com/search?q=https://your-app-frontend.onrender.com)  
* Authorized redirect URIs:  
  * Local Dev: [http://localhost:5000/api/auth/callback](http://localhost:5000/api/auth/callback)  
  * Production: [https://your-app-backend.onrender.com/api/auth/callback](https://www.google.com/search?q=https://your-app-backend.onrender.com/api/auth/callback)  
* Save the generated Client ID and Client Secret for environment variable configuration.  
3. RENDER DEPLOYMENT CHECKLIST

Part A: Deploy the Backend (Node.js / Express)

1. Log in to Render ([https://render.com](https://render.com/)) and click New \> Web Service.  
2. Connect your GitHub repository containing the Node.js backend code.  
3. Configure settings:  
   * Environment: Node  
   * Build Command: npm install  
   * Start Command: node server.js (or npm start)  
   * Instance Type: Free  
4. Set Environment Variables in Render Backend Dashboard:  
   * PORT: 5000 (or as expected by code)  
   * GOOGLE\_CLIENT\_ID: \[Your Google Client ID\]  
   * GOOGLE\_CLIENT\_SECRET: \[Your Google Client Secret\]  
   * GOOGLE\_REDIRECT\_URI: [https://your-app-backend.onrender.com/api/auth/callback](https://www.google.com/search?q=https://your-app-backend.onrender.com/api/auth/callback)  
   * FRONTEND\_URL: [https://your-app-frontend.onrender.com](https://www.google.com/search?q=https://your-app-frontend.onrender.com)  
   * SESSION\_SECRET: \[A secure random string\]  
5. Click Create Web Service and copy the live backend URL (e.g., [https://classroom-copier-api.onrender.com](https://www.google.com/search?q=https://classroom-copier-api.onrender.com)).

Part B: Deploy the Frontend (React / Tailwind)

1. Click New \> Static Site on Render.  
2. Connect the GitHub repository containing the React frontend.  
3. Configure settings:  
   * Build Command: npm run build  
   * Publish Directory: dist (for Vite/React) or build (for Create React App)  
4. Set Environment Variables in Render Frontend Dashboard:  
   * VITE\_API\_BASE\_URL: [https://classroom-copier-api.onrender.com](https://www.google.com/search?q=https://classroom-copier-api.onrender.com)  
5. Click Create Static Site.

Part C: Final URL Verification

1. Copy the finalized React app URL from Render (e.g., [https://classroom-copier.onrender.com](https://www.google.com/search?q=https://classroom-copier.onrender.com)).  
2. Return to Google Cloud Console \> Credentials \> your OAuth Client ID.  
3. Ensure [https://classroom-copier.onrender.com](https://www.google.com/search?q=https://classroom-copier.onrender.com) is added under Authorized JavaScript origins.  
4. Run a full end-to-end test transfer between two test Google Classrooms to verify OAuth token exchanges and permission scopes.

