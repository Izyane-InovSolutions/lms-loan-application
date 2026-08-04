# React Frontend - Salary Advance Engine

A modern React-based customer portal for the Salary Advance Engine with login and dashboard functionality.

## Project Structure

```
frontend/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable React components
│   │   ├── UserProfile.jsx
│   │   ├── LoanOverview.jsx
│   │   └── AccountSettings.jsx
│   ├── pages/           # Page-level components
│   │   ├── LoginPage.jsx
│   │   └── DashboardPage.jsx
│   ├── styles/          # CSS Modules
│   ├── utils/           # Utility functions
│   │   ├── auth.js      # Authentication logic
│   │   └── api.js       # API client and endpoints
│   ├── App.jsx          # Main App component with routing
│   └── main.jsx         # Entry point
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
└── package.json
```

## Features

- **Login Screen**: Session-based authentication integrated with Django backend
- **Dashboard**: Multi-tab interface with:
  - User Profile Overview
  - Loan History & Details
  - Account Settings & Preferences
- **Responsive Design**: Mobile-friendly CSS Modules styling
- **API Integration**: Ready to connect with Django backend endpoints

## Setup Instructions

### Prerequisites

- Node.js (v16+)
- npm or yarn

### Installation

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file (optional for environment variables):
   ```bash
   VITE_API_URL=http://localhost:8000
   ```

### Development

Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

### Build for Production

Build the project:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## API Endpoints Expected

The frontend expects the following Django API endpoints to be available at `/api`:

### Authentication
- `POST /api/login/` - User login (email, password)
- `POST /logout/` - User logout

### User Management
- `GET /api/users/me/` - Get current user profile
- `PUT /api/users/me/` - Update user profile
- `POST /api/users/change-password/` - Change password

### Loans
- `GET /api/loans/` - Get user's loans
- `GET /api/loans/<id>/` - Get loan details
- `POST /api/loans/request/` - Request a new loan

## Django Backend Configuration

### CORS Setup

Add the following to your Django settings to enable frontend requests:

```python
# settings/base.py or development.py
INSTALLED_APPS = [
    ...
    'corsheaders',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    ...
]

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Session settings for frontend
SESSION_COOKIE_SECURE = False  # True in production
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
```

### Required API Endpoints

Create login endpoint in your Django API (`apps/authentication/views.py` or similar):

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.contrib.auth import authenticate, login

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    email = request.data.get('email')
    password = request.data.get('password')
    
    user = authenticate(request, username=email, password=password)
    if user is not None:
        login(request, user)
        return Response({
            'id': user.id,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
        })
    return Response({'detail': 'Invalid credentials'}, status=400)
```

## Running Both Frontend and Backend

### Option 1: Separate Terminals

**Terminal 1 - Django Backend:**
```bash
python manage.py runserver
```

**Terminal 2 - React Frontend:**
```bash
cd frontend
npm run dev
```

### Option 2: Using Docker

Both services are included in `docker-compose.yml`

## Customization

### Styling

All components use CSS Modules. Modify files in `src/styles/` to customize:
- Colors: Update gradient colors in module files
- Spacing: Adjust padding/margin values
- Fonts: Modify font-family in container classes

### Adding New Pages

1. Create new component in `src/pages/`
2. Add route in `src/App.jsx`
3. Create corresponding CSS Module in `src/styles/`

### API Calls

Extend `src/utils/api.js` with additional endpoints as needed.

## Notes

- The app uses session-based authentication via cookies
- User data is stored in `sessionStorage` for client-side state
- All API requests include credentials for session management
- Remember to configure CORS in Django settings for development

## Troubleshooting

**CORS Errors**: Ensure Django settings include frontend localhost in `CORS_ALLOWED_ORIGINS`

**Login Not Working**: Check that Django API is running on port 8000 and login endpoint exists

**Styles Not Loading**: Verify CSS Modules configuration in `vite.config.js`
