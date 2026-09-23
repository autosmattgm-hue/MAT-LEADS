// Firebase Realtime Database Security Rules
// MAT LEADS AI PRO X - Lead Generation SaaS
// Copy these rules to your Firebase Console > Realtime Database > Rules

{
  "rules": {
    // Main app data
    "app": {
      "users": {
        "$userId": {
          // Users can read/write their own data
          ".read": "auth != null && (auth.uid == $userId || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          ".write": "auth != null && (auth.uid == $userId || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          
          // User settings
          "settings": {
            ".validate": "newData.hasChildren(['leadAlerts', 'weeklyDigest'])"
          }
        }
      },
      
      // Leads data
      "leads": {
        "$leadId": {
          ".read": "auth != null && (root.child('leads').child($leadId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          ".write": "auth != null && (root.child('leads').child($leadId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          
          ".validate": "newData.hasChildren(['userId', 'name', 'address', 'searchQuery'])"
        }
      },
      
      // CRM activities
      "activities": {
        "$activityId": {
          ".read": "auth != null && (root.child('activities').child($activityId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          ".write": "auth != null && (root.child('activities').child($activityId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local')"
        }
      }
    },
    
    // Chat/history for AI conversations
    "chat": {
      "conversations": {
        "$conversationId": {
          ".read": "auth != null && (root.child('chat').child('conversations').child($conversationId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
          ".write": "auth != null && root.child('chat').child('conversations').child($conversationId).child('userId').val() == auth.uid || auth.token.admin === true || auth.token.email == 'owner@matleads.local'"
        }
      }
    },
    
    // Analytics data (owner/admin only)
    "analytics": {
      ".read": "auth != null && (auth.token.admin === true || auth.token.email == 'owner@matleads.local')",
      ".write": "auth != null && (auth.token.admin === true || auth.token.email == 'owner@matleads.local')"
    },
    
    // A/B test configurations
    "experiments": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.admin === true || auth.token.email == 'owner@matleads.local')"
    },
    
    // Feature flags
    "features": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.admin === true || auth.token.email == 'owner@matleads.local')"
    },
    
    // Deny all other paths
    ".read": "auth != null",
    ".write": "auth != null && (auth.token.admin === true || auth.token.email == 'owner@matleads.local')"
  }
}