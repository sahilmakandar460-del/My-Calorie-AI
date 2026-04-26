/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  RotateCcw,
  History, 
  ChevronLeft, 
  ChevronRight,
  Loader2, 
  Plus, 
  Search,
  Zap,
  Flame,
  Soup,
  Beef,
  Wheat,
  Droplets,
  MoreVertical,
  X,
  LogOut,
  Target,
  Settings as SettingsIcon,
  ChefHat,
  UtensilsCrossed,
  User as UserIcon,
  Share2,
  Bell,
  CheckCircle2,
  Check,
  Waves,
  AlertTriangle,
  Info,
  TrendingDown,
  TrendingUp,
  BarChart as BarChartIcon,
  Calendar,
  Activity,
  Trophy,
  Scale,
  Star,
  Trash2,
  Edit2,
  Image as ImageIcon,
  UploadCloud,
  Shield
} from 'lucide-react';
import { cn } from './lib/utils';
import { analyzeFoodImage } from './services/geminiService';
import { 
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  Dot,
  LabelList
} from 'recharts';
import { format, subDays, startOfDay, isAfter, parseISO } from 'date-fns';
import { NutritionData, MealHistoryItem, UserSettings, WeightEntry } from './types';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  doc, 
  setDoc, 
  getDoc,
  getDocFromServer,
  orderBy,
  limit,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';

// Helper to get formatted date
const getTodayStr = () => new Date().toISOString().split('T')[0];

const BADGES = [
  { id: 'first_scan', name: 'First Scan ⚡', description: 'Log your very first meal scan!', icon: 'Zap', color: 'bg-yellow-400' },
  { id: 'streak_7', name: '7 Day Streak 🔥', description: 'Log your meals for 7 consecutive days!', icon: 'Flame', color: 'bg-orange-500' },
  { id: 'goal_7', name: 'Goal Master 🎯', description: 'Hit your calorie goal for 7 days!', icon: 'Target', color: 'bg-emerald-500' },
  { id: 'explorer_10', name: 'Food Explorer 🍽️', description: 'Scan 10 different types of food!', icon: 'UtensilsCrossed', color: 'bg-cyan-500' },
  { id: 'champion_30', name: '30 Day Champion 🏆', description: 'Stay committed for 30 full days!', icon: 'Trophy', color: 'bg-purple-500' },
];


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}


export default function App() {
  // Performance Monitor
  useEffect(() => {
    let lastTime = performance.now();
    let frames = 0;
    const checkLag = () => {
      const now = performance.now();
      frames++;
      if (now > lastTime + 1000) {
        const fps = Math.round((frames * 1000) / (now - lastTime));
        if (fps < 40) {
          console.warn(`[PERF] Lag detected: ${fps} FPS`);
        }
        frames = 0;
        lastTime = now;
      }
      requestAnimationFrame(checkLag);
    };
    const requestRef = requestAnimationFrame(checkLag);
    return () => cancelAnimationFrame(requestRef);
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'scan' | 'analyze' | 'result' | 'history' | 'dashboard' | 'settings' | 'profile' | 'chart' | 'progress' | 'weight' | 'meal_history' | 'badges' | 'privacy-policy'>('dashboard');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [history, setHistory] = useState<MealHistoryItem[]>([]);
  const [weightHistory, setWeightHistory] = useState<WeightEntry[]>([]);
  const [chartMode, setChartMode] = useState<'weekly' | 'monthly'>('weekly');
  const [userSettings, setUserSettings] = useState<UserSettings>({ 
    dailyGoal: 2000, 
    waterGoal: 8, 
    waterIntake: 0, 
    notifiedToday: false, 
    theme: 'dark',
    mealRemindersEnabled: false,
    breakfastReminder: '08:00',
    lunchReminder: '13:00',
    dinnerReminder: '20:00'
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);
  const [showRatePopup, setShowRatePopup] = useState(false);
  const [mealToDelete, setMealToDelete] = useState<string | null>(null);

  // Online/Offline tracking
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Rating popup logic (3 days checked)
  useEffect(() => {
    if (user && userSettings.firstUsedTimestamp && !userSettings.hasRated) {
      const daysUsed = (Date.now() - userSettings.firstUsedTimestamp) / (1000 * 60 * 60 * 24);
      if (daysUsed >= 3) {
        setShowRatePopup(true);
      }
    }
  }, [user, userSettings]);

  // Weight History Sync
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'weightHistory'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(30)
    );
    return onSnapshot(q, (snapshot) => {
      setWeightHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WeightEntry)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'weightHistory');
    });
  }, [user]);

  // Meal Reminders System
  useEffect(() => {
    if (!user || !userSettings.mealRemindersEnabled) return;

    const checkReminders = () => {
      const now = new Date();
      const currentTime = format(now, 'HH:mm');
      
      const reminders = [
        { time: userSettings.breakfastReminder, label: 'Breakfast' },
        { time: userSettings.lunchReminder, label: 'Lunch' },
        { time: userSettings.dinnerReminder, label: 'Dinner' }
      ];

      reminders.forEach(r => {
        if (r.time === currentTime) {
          if (Notification.permission === 'granted') {
            new Notification("Don't forget to log your meal 🍽", {
              body: `It's time for ${r.label}! Keep track of your calories.`,
            });
          } else {
            console.log(`Reminder: It's time for ${r.label}!`);
          }
        }
      });
    };

    const interval = setInterval(checkReminders, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [user, userSettings]);
  const [todaysMeals, setTodaysMeals] = useState<MealHistoryItem[]>([]);
  const [todayStr, setTodayStr] = useState(getTodayStr());
  const [tempGoal, setTempGoal] = useState<number>(2000);

  const getChartData = () => {
    const daysToLookBack = chartMode === 'weekly' ? 7 : 30;
    const data: Record<string, number> = {};
    const now = new Date();

    for (let i = 0; i < daysToLookBack; i++) {
      const d = subDays(startOfDay(now), i);
      const dateStr = format(d, 'yyyy-MM-dd');
      data[dateStr] = 0;
    }

    history.forEach(item => {
      if (data[item.date] !== undefined) {
        data[item.date] += item.calories;
      }
    });

    return Object.entries(data).map(([date, calories]) => {
      const d = parseISO(date);
      return {
        date,
        calories,
        dayName: format(d, chartMode === 'weekly' ? 'EEE' : 'MMM d'),
        target: userSettings.dailyGoal
      };
    }).reverse();
  };

  const chartData = React.useMemo(() => getChartData(), [history, userSettings.dailyGoal, chartMode]);
  const avgCalories = React.useMemo(() => chartData.length > 0 
    ? Math.round(chartData.reduce((acc, curr) => acc + curr.calories, 0) / chartData.length)
    : 0, [chartData]);
  const goalCleanRate = React.useMemo(() => chartData.length > 0
    ? Math.round((chartData.filter(d => d.calories > 0 && d.calories <= d.target).length / (chartData.filter(d => d.calories > 0).length || 1)) * 100)
    : 0, [chartData]);

  const [tempWaterGoal, setTempWaterGoal] = useState<number>(8);
  const [isSaving, setIsSaving] = useState(false);
  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.warn("Firestore is working in offline mode.");
        } else {
          console.error("Connection test failed:", error);
        }
      }
    };
    testConnection();
  }, []);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const handleFirestoreError = React.useCallback((error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setGlobalError(`Firestore error: ${errInfo.error} (${operationType} on ${path})`);
  }, []);
  const [showCompletionMsg, setShowCompletionMsg] = useState(false);
  const [sharedMeal, setSharedMeal] = useState<MealHistoryItem | null>(null);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<boolean>(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionValue, setCorrectionValue] = useState<number | ''>('');
  const [correctionProtein, setCorrectionProtein] = useState<number | ''>('');
  const [correctionCarbs, setCorrectionCarbs] = useState<number | ''>('');
  const [correctionFat, setCorrectionFat] = useState<number | ''>('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [hasCorrected, setHasCorrected] = useState(false);
  const [targetWeightSuccess, setTargetWeightSuccess] = useState(false);
  const [isEditingTargetWeight, setIsEditingTargetWeight] = useState(false);
  const [isReAnalyzing, setIsReAnalyzing] = useState(false);
  const [reAnalysisHint, setReAnalysisHint] = useState("");
  const [earnedBadgePopup, setEarnedBadgePopup] = useState<typeof BADGES[0] | null>(null);
  const [branding, setBranding] = useState<{ logoUrl: string | null; appName: string }>({ 
    logoUrl: null, 
    appName: 'MyCalorie AI' 
  });
  const [rebrandingName, setRebrandingName] = useState('MyCalorie AI');

  const ADMIN_EMAIL = 'sahilmakandar460@gmail.com';
  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'appConfig', 'branding'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as any;
        setBranding(data);
        setRebrandingName(data.appName || 'MyCalorie AI');
      }
    }, (error) => {
      console.warn("Could not fetch app branding:", error.message);
    });
  }, [user]);

  const handleAppNameUpdate = async () => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'appConfig', 'branding'), { appName: rebrandingName });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'appConfig/branding');
    }
  };

  const updateAchievements = async (newMeal?: Partial<MealHistoryItem>) => {
    if (!user) return;
    
    const updatedSettings = { ...userSettings };
    const earnedBadges = [...(updatedSettings.badges || [])];
    const newlyEarned: typeof BADGES[0][] = [];

    // 1. First Scan
    if (history.length === 0 && newMeal && !earnedBadges.includes('first_scan')) {
      earnedBadges.push('first_scan');
      newlyEarned.push(BADGES.find(b => b.id === 'first_scan')!);
    }

    // 2. Streak & Food Explorer Logic
    const today = getTodayStr();
    if (newMeal && newMeal.foodName) {
      const foods = new Set(updatedSettings.uniqueFoods || []);
      foods.add(newMeal.foodName);
      updatedSettings.uniqueFoods = Array.from(foods);
      
      if (updatedSettings.uniqueFoods.length >= 10 && !earnedBadges.includes('explorer_10')) {
        earnedBadges.push('explorer_10');
        newlyEarned.push(BADGES.find(b => b.id === 'explorer_10')!);
      }
    }

    // Streak Check
    if (newMeal && updatedSettings.lastLogDate !== today) {
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      if (updatedSettings.lastLogDate === yesterday) {
        updatedSettings.streak = (updatedSettings.streak || 0) + 1;
      } else if (updatedSettings.lastLogDate !== today) {
        updatedSettings.streak = 1;
      }
      updatedSettings.lastLogDate = today;

      if (updatedSettings.streak >= 7 && !earnedBadges.includes('streak_7')) {
        earnedBadges.push('streak_7');
        newlyEarned.push(BADGES.find(b => b.id === 'streak_7')!);
      }
    }

    // 30 day champion
    if (updatedSettings.firstUsedTimestamp) {
      const days = Math.floor((Date.now() - updatedSettings.firstUsedTimestamp) / (1000 * 60 * 60 * 24));
      if (days >= 30 && !earnedBadges.includes('champion_30')) {
        earnedBadges.push('champion_30');
        newlyEarned.push(BADGES.find(b => b.id === 'champion_30')!);
      }
    }

    // Goal Master check logic
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    });

    const dayStats = last7Days.map(dayStr => {
      const dayMeals = history.filter(m => m.date === dayStr);
      const dayCals = dayMeals.reduce((acc, m) => acc + (m.calories || 0), 0) + (dayStr === today ? (newMeal?.calories || 0) : 0);
      return dayCals > 0 && dayCals <= (updatedSettings.dailyGoal + 100);
    });
    if (dayStats.every(v => v) && !earnedBadges.includes('goal_7')) {
      earnedBadges.push('goal_7');
      newlyEarned.push(BADGES.find(b => b.id === 'goal_7')!);
    }

    if (newlyEarned.length > 0) {
      updatedSettings.badges = earnedBadges;
      setEarnedBadgePopup(newlyEarned[0]);
      setTimeout(() => setEarnedBadgePopup(null), 5000);
    }

    // Goal met check happens elsewhere or could be here
    // For simplicity, we update locally and sync
    setUserSettings(updatedSettings);
    await updateDoc(doc(db, 'users', user.uid), {
      badges: updatedSettings.badges || [],
      streak: updatedSettings.streak || 0,
      lastLogDate: updatedSettings.lastLogDate || today,
      uniqueFoods: updatedSettings.uniqueFoods || [],
      goalMetDays: updatedSettings.goalMetDays || 0
    });
  };

  // Theme Watcher
  useEffect(() => {
    if (userSettings.theme === 'light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
  }, [userSettings.theme]);

  // Sync tempGoal when userSettings loads
  useEffect(() => {
    setTempGoal(userSettings.dailyGoal);
    setTempWaterGoal(userSettings.waterGoal || 8);
    setCorrectionValue(nutrition?.calories || 0);
  }, [userSettings.dailyGoal, userSettings.waterGoal, nutrition]);

  // Handle Shared Link on Mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mealId = params.get('share');
    if (mealId) {
      const fetchSharedMeal = async () => {
        setSharingLoading(true);
        try {
          const mDoc = await getDoc(doc(db, 'meals', mealId));
          if (mDoc.exists()) {
            setSharedMeal({ id: mDoc.id, ...mDoc.data() } as MealHistoryItem);
          } else {
            setGlobalError("Shared meal not found or has been deleted.");
          }
        } catch (e) {
          setGlobalError("Failed to load shared meal.");
        } finally {
          setSharingLoading(false);
        }
      };
      fetchSharedMeal();
    }
  }, []);

  // Water Reminders
  useEffect(() => {
    if (!userSettings.waterRemindersEnabled || !user) return;
    
    const intervalMs = (userSettings.reminderInterval || 60) * 60000;
    const interval = setInterval(() => {
      if (Notification.permission === 'granted') {
        new Notification("Time to drink water 💧", {
          body: "Keep your metabolism high! Rehydrate now.",
          icon: "/favicon.ico"
        });
      } else {
        alert("💧 Time to drink water.");
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [userSettings.waterRemindersEnabled, userSettings.reminderInterval, user]);

  // Date Watcher (for midnight reset)
  useEffect(() => {
    const interval = setInterval(() => {
      const current = getTodayStr();
      if (current !== todayStr) {
        setTodayStr(current);
        handleDailyReset(current);
      }
    }, 15000); // Check more frequently
    return () => clearInterval(interval);
  }, [todayStr]);

  const handleDailyReset = async (newDate: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        waterIntake: 0,
        notifiedToday: false,
        lastResetDate: newDate
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
      alert("New Day Started 🌅");
    } catch (e) {
      console.error("Reset failed", e);
    }
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<boolean>(false);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          const currentDay = getTodayStr();
          
          if (userDoc.exists()) {
            const data = userDoc.data() as UserSettings;
            // Check if day changed while offline
            if (data.lastResetDate !== currentDay) {
               const updated = { ...data, waterIntake: 0, notifiedToday: false, lastResetDate: currentDay };
               await setDoc(doc(db, 'users', u.uid), updated).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`));
               setUserSettings(updated);
            } else {
               setUserSettings(data);
            }
          } else {
            // Initialize for new user
            const initial = { 
              dailyGoal: 2000, 
              waterGoal: 8,
              email: u.email || '', 
              waterIntake: 0, 
              notifiedToday: false,
              lastResetDate: currentDay,
              waterRemindersEnabled: false,
              reminderInterval: 60,
              theme: 'dark',
              mealRemindersEnabled: false,
              breakfastReminder: '08:00',
              lunchReminder: '13:00',
              dinnerReminder: '20:00',
              firstUsedTimestamp: Date.now(),
              hasRated: false,
              targetWeight: 70
            };
            await setDoc(doc(db, 'users', u.uid), initial).catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${u.uid}`));
            setUserSettings(initial as UserSettings);
          }
        } catch (err) {
          setGlobalError("Connection failure. Check your internet.");
        }
      }
      setLoading(false);
    });
  }, []);

  // Completion Notification Watcher
  useEffect(() => {
    if (userSettings.notifiedToday || !user) return;
    const todayCals = todaysMeals.reduce((acc, c) => acc + (c.calories || 0), 0);
    if (todayCals >= userSettings.dailyGoal && userSettings.dailyGoal > 0) {
       setShowCompletionMsg(true);
       
       const updatedGoalMetDays = (userSettings.goalMetDays || 0) + 1;
       const updateData: any = { 
         notifiedToday: true,
         goalMetDays: updatedGoalMetDays
       };

       // Check Goal Master Badge
       let newlyEarned: typeof BADGES[0] | null = null;
       const earnedBadges = [...(userSettings.badges || [])];
       if (updatedGoalMetDays >= 7 && !earnedBadges.includes('goal_7')) {
         earnedBadges.push('goal_7');
         updateData.badges = earnedBadges;
         newlyEarned = BADGES.find(b => b.id === 'goal_7')!;
       }

       updateDoc(doc(db, 'users', user.uid), updateData).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
       
       setUserSettings(prev => ({ 
         ...prev, 
         notifiedToday: true, 
         goalMetDays: updatedGoalMetDays,
         badges: earnedBadges
       }));

       if (newlyEarned) {
         setEarnedBadgePopup(newlyEarned);
         setTimeout(() => setEarnedBadgePopup(null), 5000);
       }
    }
  }, [todaysMeals, userSettings.dailyGoal, userSettings.notifiedToday, user]);

  // Offline Sync Effect
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && user) {
      const syncItems = async () => {
        const queue = [...offlineQueue];
        setOfflineQueue([]); // Clear queue immediately to prevent double sync
        
        for (const item of queue) {
          try {
            if (item.type === 'meal') {
              await addDoc(collection(db, 'meals'), item.data).catch(e => handleFirestoreError(e, OperationType.CREATE, 'meals'));
            } else if (item.type === 'weight') {
              await addDoc(collection(db, 'weightHistory'), item.data).catch(e => handleFirestoreError(e, OperationType.CREATE, 'weightHistory'));
            }
          } catch (e) {
            console.error("Sync failed for item:", item, e);
          }
        }
        setGlobalError("Offline data synced successfully! 🔄");
      };
      syncItems();
    }
  }, [isOnline, offlineQueue, user]);

  // Real-time Dashboard Sync (Today's Meals)
  useEffect(() => {
    if (!user) return;

    const mealsRef = collection(db, 'meals');
    const q = query(
      mealsRef, 
      where('userId', '==', user.uid),
      where('date', '==', todayStr),
      orderBy('timestamp', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const meals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MealHistoryItem));
      setTodaysMeals(meals);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meals');
    });
  }, [user]);

  // General History Sync
  useEffect(() => {
    if (!user) return;
    const mealsRef = collection(db, 'meals');
    const q = query(
      mealsRef, 
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    return onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MealHistoryItem)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meals');
    });
  }, [user]);

  // Camera handling (from original)
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    if (mode === 'scan') {
      const startCamera = async () => {
        setCameraError(false);
        try {
          let mediaStream: MediaStream;
          try {
            // Optimized resolution for performance
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'environment', width: { ideal: 800 }, height: { ideal: 600 } } 
            });
          } catch (e) {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
          activeStream = mediaStream;
          setStream(mediaStream);
          if (videoRef.current) videoRef.current.srcObject = mediaStream;
        } catch (err) {
          setCameraError(true);
        }
      };
      startCamera();
    }
    return () => {
      if (activeStream) activeStream.getTracks().forEach(track => track.stop());
    };
  }, [mode]);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    // Learning system: Gather recent corrections
    const correctionRecords = history
      .filter(m => m.isCorrected)
      .slice(0, 5)
      .map(m => `- ${m.foodName}: ${m.calories} kcal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F`)
      .join('\n');

    const MAX_DIM = 640; // Reduced for faster AI scan
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height) {
      if (width > MAX_DIM) {
        height *= MAX_DIM / width;
        width = MAX_DIM;
      }
    } else {
      if (height > MAX_DIM) {
        width *= MAX_DIM / height;
        height = MAX_DIM;
      }
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false }); // Performance optimization
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // Reduced quality for faster scan
    setCapturedImage(dataUrl);
    setMode('analyze');

    try {
      const correctionRecords = history
        .filter(m => m.isCorrected)
        .slice(0, 5)
        .map(m => `- ${m.foodName}: ${m.calories} kcal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F`)
        .join('\n');

      const result = await analyzeFoodImage(dataUrl.split(',')[1], undefined, correctionRecords);
      setNutrition(result);
      // Memory cleanup
      setMode('result');
    } catch (err) {
      setMode('scan');
      alert("AI Processing Failed: Please try again.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        setCapturedImage(dataUrl);
        setMode('analyze');
        try {
          const correctionRecords = history
            .filter(m => m.isCorrected)
            .slice(0, 5)
            .map(m => `- ${m.foodName}: ${m.calories} kcal, ${m.protein}g P, ${m.carbs}g C, ${m.fat}g F`)
            .join('\n');

          const result = await analyzeFoodImage(dataUrl.split(',')[1], undefined, correctionRecords);
          setNutrition(result);
          setMode('result');
        } catch (err) {
          setMode('scan');
          alert("AI Analysis Failed");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteMeal = async (mealId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'meals', mealId)).catch(e => handleFirestoreError(e, OperationType.DELETE, `meals/${mealId}`));
      setHistory(prev => prev.filter(m => m.id !== mealId));
      setMealToDelete(null);
      setGlobalError("Meal record deleted.");
    } catch (err) {
      setGlobalError("Failed to delete meal.");
    }
  };

  const logWeight = async (weight: number) => {
    if (!user) return;
    
    const entry = {
      userId: user.uid,
      weight,
      timestamp: Date.now(),
      targetWeight: userSettings.targetWeight || null
    };

    if (!isOnline) {
      const offlineEntry = { id: Math.random().toString(36).substr(2, 9), ...entry } as WeightEntry;
      setOfflineQueue(prev => [...prev, { type: 'weight', data: entry }]);
      setWeightHistory(prev => [offlineEntry, ...prev]);
      alert("Saved offline. Will sync when online. ⚖️");
      setMode('dashboard');
      return;
    }

    try {
      await addDoc(collection(db, 'weightHistory'), entry).catch(e => handleFirestoreError(e, OperationType.CREATE, 'weightHistory'));
      setMode('dashboard');
      alert("Weight logged successfully! ⚖️");
    } catch (error) {
      setGlobalError("Failed to log weight.");
    }
  };

  const saveMeal = async () => {
    if (nutrition && capturedImage && user) {
      setIsSaving(true);
      setGlobalError(null);
      
      const mealData = {
        foodName: nutrition.foodName,
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fiber: nutrition.fiber || 0,
        description: nutrition.description,
        ingredients: nutrition.ingredients,
        micronutrients: nutrition.micronutrients || [],
        estimatedPortion: nutrition.estimatedPortion || '',
        userId: user.uid,
        timestamp: Date.now(),
        date: getTodayStr(),
        imageUrl: capturedImage,
        isCorrected: hasCorrected
      };

      if (!isOnline) {
        const offlineMeal = { id: Math.random().toString(36).substr(2, 9), ...mealData } as MealHistoryItem;
        setOfflineQueue(prev => [...prev, { type: 'meal', data: mealData }]);
        setHistory(prev => [offlineMeal, ...prev]);
        alert("Meal saved offline. Will sync when online. 🍔");
        setMode('dashboard');
        setNutrition(null);
        setCapturedImage(null);
        setIsSaving(false);
        updateAchievements(mealData);
        return;
      }
      
      try {
        await addDoc(collection(db, 'meals'), mealData).catch(e => handleFirestoreError(e, OperationType.CREATE, 'meals'));
        setMode('dashboard');
        setNutrition(null);
        setCapturedImage(null); // Clear memory
        updateAchievements(mealData);
        setHasCorrected(false);
      } catch (err) {
        setGlobalError("Something went wrong. Please try again.");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const addWater = async () => {
    if (!user || isSaving) return;
    setIsSaving(true);
    const newCount = (userSettings.waterIntake || 0) + 1;
    try {
      await updateDoc(doc(db, 'users', user.uid), { waterIntake: newCount }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
      setUserSettings(prev => ({ ...prev, waterIntake: newCount }));
    } catch (e) {
      setGlobalError("Failed to update water intake.");
    } finally {
      setIsSaving(false);
    }
  };

  const shareApp = async () => {
    const shareData = {
      title: 'AI Calorie Tracker',
      text: 'Try this AI Calorie Tracker App to scan food and track calories easily!',
      url: window.location.href
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        alert("App link copied to clipboard! Share it with friends.");
      }
    } catch (err) {
      console.log('Error sharing:', err);
    }
  };

  const shareMealLink = async (mealId: string) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${mealId}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'My Meal Detail',
          text: 'Check out my healthy meal!',
          url: shareUrl
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        alert("Meal link copied to clipboard!");
      }
    } catch (e) {
      console.log("Sharing failed", e);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Check pre-compression file size (2MB limit for original to prevent browser hang)
    if (file.size > 2 * 1024 * 1024) {
      setGlobalError("Image file is too large. Please select an image under 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        // Reduced dimensions: 200x200 is sufficient for a 90x90 display
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Use jpeg with 0.6 quality for aggressive compression
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
          try {
            await updateDoc(doc(db, 'appConfig', 'branding'), { logoUrl: compressedBase64 }).catch(async (e) => {
              if (e.code === 'not-found') {
                await setDoc(doc(db, 'appConfig', 'branding'), { logoUrl: compressedBase64, appName: rebrandingName || 'MyCalorie AI' });
              } else {
                handleFirestoreError(e, OperationType.UPDATE, 'appConfig/branding');
              }
            });
            setBranding(prev => ({ ...prev, logoUrl: compressedBase64 }));
          } catch (err) {
            console.error("Logo upload failed", err);
            setGlobalError("Failed to save logo. Please try a different image.");
          }
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleReAnalyze = async () => {
    if (!capturedImage) return;
    setIsReAnalyzing(true);
    setFeedbackError(null);
    try {
      const base64 = capturedImage.split(',')[1];
      const result = await analyzeFoodImage(base64, reAnalysisHint || undefined);
      setNutrition(result);
      setIsCorrecting(false);
      setReAnalysisHint("");
    } catch (error) {
      setFeedbackError("Re-analysis failed. Please try again.");
    } finally {
      setIsReAnalyzing(false);
    }
  };

  const submitFeedback = async (isAccurate: boolean) => {
    if (!user || !nutrition) return;
    
    if (!isAccurate && correctionValue === '') {
      setFeedbackError("Please enter corrected calories.");
      return;
    }

    setFeedbackError(null);
    
    const feedbackData = {
      mealId: (nutrition.foodName + Date.now()).replace(/[^a-zA-Z0-9]/g, '_'), 
      foodName: nutrition.foodName,
      imageUrl: capturedImage,
      originalCalories: nutrition.calories,
      correctedCalories: isAccurate ? nutrition.calories : Number(correctionValue),
      correctedProtein: (!isAccurate && correctionProtein !== '') ? Number(correctionProtein) : null,
      correctedCarbs: (!isAccurate && correctionCarbs !== '') ? Number(correctionCarbs) : null,
      correctedFat: (!isAccurate && correctionFat !== '') ? Number(correctionFat) : null,
      isAccurate,
      timestamp: Date.now(),
      userId: user.uid
    };

    try {
      await addDoc(collection(db, 'feedback'), feedbackData).catch(e => handleFirestoreError(e, OperationType.CREATE, 'feedback'));
      
      if (!isAccurate) {
        // Update nutrition state with corrected values for logging
        setNutrition(prev => prev ? { 
          ...prev, 
          calories: Number(correctionValue),
          protein: correctionProtein !== '' ? Number(correctionProtein) : prev.protein,
          carbs: correctionCarbs !== '' ? Number(correctionCarbs) : prev.carbs,
          fat: correctionFat !== '' ? Number(correctionFat) : prev.fat
        } : null);
        setIsCorrecting(false);
      }
      
      setFeedbackSuccess(true);
      setFeedbackMode(true);
      if (!isAccurate) setHasCorrected(true);
      setTimeout(() => {
        setFeedbackMode(false);
        setFeedbackSuccess(false);
      }, 3000);
      setIsCorrecting(false);
      // Reset form
      setCorrectionValue('');
      setCorrectionProtein('');
      setCorrectionCarbs('');
      setCorrectionFat('');
    } catch (e) {
      setGlobalError("Feedback submission failed.");
    }
  };

  const updateGoal = async (goal: number) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { dailyGoal: goal }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
      setUserSettings({ ...userSettings, dailyGoal: goal });
    } catch (err) {
      alert("Failed to update goal.");
    }
  };

  const updateWaterGoal = async (goal: number) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { waterGoal: goal }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
      setUserSettings({ ...userSettings, waterGoal: goal });
    } catch (err) {
      alert("Failed to update water goal.");
    }
  };

  const applyGoals = async () => {
    await updateGoal(tempGoal);
    await updateWaterGoal(tempWaterGoal);
    setMode('dashboard');
  };

  const todayCalories = React.useMemo(() => todaysMeals.reduce((acc, current) => acc + (current.calories || 0), 0), [todaysMeals]);
  const calorieDiff = userSettings.dailyGoal - todayCalories;
  const remainingCalories = Math.max(0, calorieDiff);
  const progressPercent = Math.min(100, (todayCalories / userSettings.dailyGoal) * 100);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mb-4" />
        <p className="text-white/40 font-bold uppercase tracking-widest text-xs">Initializing App</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-6 text-white font-sans overflow-hidden">
         <div className="fixed inset-0 bg-[#1e1b4b]" style={{
            background: 'radial-gradient(circle at 0% 0%, #4f46e5 0%, transparent 50%), radial-gradient(circle at 100% 0%, #ec4899 0%, transparent 50%), radial-gradient(circle at 100% 100%, #8b5cf6 0%, transparent 50%), radial-gradient(circle at 0% 100%, #06b6d4 0%, transparent 50%), #1e1b4b'
         }} />
         <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px]" />
         
         <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-3xl glass flex items-center justify-center mb-8 shadow-2xl">
              <ChefHat className="w-12 h-12 text-cyan-400" />
            </div>
            <h1 className="text-4xl font-black tracking-tight mb-4 uppercase">AI Nutrition</h1>
            <p className="text-white/60 mb-12 text-sm leading-relaxed px-4">
              Snap food, track calories, and reach your goals with Gemini-powered AI analysis.
            </p>
            <button 
              onClick={signInWithGoogle}
              className="w-full py-5 bg-white text-indigo-950 font-black rounded-[2rem] shadow-2xl active:scale-95 transition-transform flex items-center justify-center gap-3"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              CONTINUE WITH GOOGLE
            </button>
            <p className="mt-8 text-[10px] text-white/30 font-bold uppercase tracking-[0.2em]">Secure Cloud Storage Included</p>
         </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white font-sans overflow-hidden bg-slate-950">
      <div className="fixed inset-0 bg-black/10 backdrop-blur-[2px] pointer-events-none z-0" />

      {/* Shared Meal Overlay */}
      <AnimatePresence>
        {(sharedMeal || sharingLoading) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-slate-950 flex flex-col items-center p-6 overflow-y-auto no-scrollbar"
          >
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => { setSharedMeal(null); window.history.replaceState({}, '', window.location.pathname); }}
                  className="p-3 glass rounded-2xl"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="text-center">
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Shared Discovery</p>
                  <h1 className="font-black text-xl">Meal Review</h1>
                </div>
                <div className="w-12 h-12" /> {/* Spacer */}
              </div>

              {sharingLoading ? (
                <div className="flex flex-col items-center justify-center p-20">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mb-4" />
                  <p className="text-white/40 font-bold uppercase tracking-widest text-xs">Fetching meal data</p>
                </div>
              ) : sharedMeal && (
                <div className="space-y-6">
                  <div className="relative group">
                    <img 
                      src={sharedMeal.imageUrl} 
                      className="w-full aspect-square object-cover rounded-[3rem] shadow-2xl border border-white/5" 
                      alt="Shared Meal" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent rounded-[3rem]" />
                    <div className="absolute bottom-8 left-8 right-8">
                      <h2 className="text-3xl font-black mb-2 line-clamp-2 break-words leading-tight">{sharedMeal.foodName}</h2>
                      <div className="flex gap-2">
                        <div className="px-3 py-1 glass rounded-full text-[10px] font-black uppercase text-cyan-400">
                          {sharedMeal.calories} kcal
                        </div>
                        <div className="px-3 py-1 glass rounded-full text-[10px] font-black uppercase text-white/60">
                          {new Date(sharedMeal.timestamp).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="glass p-4 rounded-3xl text-center">
                       <p className="text-[10px] font-black text-white/40 uppercase mb-1">Protein</p>
                       <p className="font-black text-lg">{sharedMeal.protein}g</p>
                    </div>
                    <div className="glass p-4 rounded-3xl text-center">
                       <p className="text-[10px] font-black text-white/40 uppercase mb-1">Carbs</p>
                       <p className="font-black text-lg">{sharedMeal.carbs}g</p>
                    </div>
                    <div className="glass p-4 rounded-3xl text-center">
                       <p className="text-[10px] font-black text-white/40 uppercase mb-1">Fat</p>
                       <p className="font-black text-lg">{sharedMeal.fat}g</p>
                    </div>
                  </div>

                  <div className="glass-card p-6 rounded-[2.5rem]">
                    <h4 className="text-xs font-black uppercase text-white/40 mb-4 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      Nutrition breakdown
                    </h4>
                    <p className="text-sm font-medium leading-relaxed text-white/70 italic">
                      "{sharedMeal.description}"
                    </p>
                  </div>

                  <button 
                    onClick={() => { setSharedMeal(null); window.history.replaceState({}, '', window.location.pathname); if(!user) signInWithGoogle(); }}
                    className="w-full py-5 bg-gradient-to-r from-cyan-500 to-blue-600 font-black rounded-[2rem] shadow-xl shadow-cyan-500/20"
                  >
                    {user ? 'BACK TO MY DASHBOARD' : 'TRY AI TRACKER NOW'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[1000] bg-orange-600 text-white text-[10px] font-black uppercase py-2 text-center tracking-[0.2em] shadow-xl flex items-center justify-center gap-2">
           <AlertTriangle className="w-3 h-3" />
           Offline Mode • Data will sync on return
        </div>
      )}

      {/* Rating Popup */}
      <AnimatePresence>
        {showRatePopup && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md"
          >
            <div className="glass-card p-10 rounded-[3rem] border border-cyan-500/30 text-center max-w-sm w-full relative overflow-hidden shadow-2xl">
               <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto mb-6">
                  <Star className="w-8 h-8 text-cyan-400" />
               </div>
               <h3 className="text-2xl font-black mb-2">Enjoying {branding.appName || 'MyCalorie AI'}?</h3>
               <p className="text-white/60 mb-8 font-bold leading-relaxed">
                 Please take a second to rate us! Your feedback helps us improve the AI for everyone.
               </p>
               <div className="flex flex-col gap-3">
                 <button 
                  onClick={async () => {
                    const url = "https://play.google.com/store/apps/details?id=com.mycalorie.ai";
                    window.open(url, '_blank');
                    await updateDoc(doc(db, 'users', user!.uid), { hasRated: true });
                    setUserSettings(prev => ({ ...prev, hasRated: true }));
                    setShowRatePopup(false);
                  }}
                  className="w-full py-4 bg-cyan-500 text-white font-black rounded-2xl shadow-xl shadow-cyan-500/20"
                 >
                   RATE NOW ⭐
                 </button>
                 <button 
                  onClick={() => setShowRatePopup(false)}
                  className="w-full py-4 glass text-white/40 font-black rounded-2xl"
                 >
                   MAYBE LATER
                 </button>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Badge Screen */}
      <AnimatePresence>
        {mode === 'badges' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-3xl overflow-y-auto no-scrollbar p-6"
          >
            <div className="max-w-md mx-auto pt-8 pb-32">
              <div className="flex items-center justify-between mb-12">
                <button onClick={() => setMode('dashboard')} className="glass p-4 rounded-3xl">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="text-center">
                  <h2 className="text-3xl font-black tracking-tight">Achievements</h2>
                  <p className="text-xs font-bold text-white/40 uppercase tracking-widest mt-1">
                    {userSettings.badges?.length || 0} / {BADGES.length} Unlocked
                  </p>
                </div>
                <div className="w-14" />
              </div>

              <div className="grid grid-cols-1 gap-4">
                {BADGES.map((badge) => {
                  const isUnlocked = userSettings.badges?.includes(badge.id);
                  return (
                    <div 
                      key={badge.id}
                      className={`glass p-6 rounded-[2.5rem] border transition-all duration-500 ${isUnlocked ? 'border-yellow-400/30' : 'border-white/5 opacity-50 grayscale'}`}
                    >
                      <div className="flex items-center gap-6">
                        <div className={`w-20 h-20 rounded-3xl ${badge.color} flex items-center justify-center shadow-2xl shrink-0 ${!isUnlocked && 'bg-slate-800'}`}>
                          <div className={isUnlocked ? 'text-slate-900' : 'text-white/20'}>
                             {(() => {
                               const Icon = { Zap, Flame, Target, UtensilsCrossed, Trophy }[badge.icon] || Star;
                               return <Icon className="w-10 h-10" />;
                             })()}
                          </div>
                        </div>
                        <div>
                          <h3 className={`text-xl font-black ${isUnlocked ? 'text-white' : 'text-white/40'}`}>{badge.name}</h3>
                          <p className="text-xs text-white/40 mt-1 font-medium leading-relaxed">
                            {badge.description}
                          </p>
                          {!isUnlocked && (
                             <div className="mt-3 flex items-center gap-2">
                               <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                  <div className="w-1/4 h-full bg-white/20" />
                               </div>
                               <span className="text-[10px] font-black text-white/20 uppercase">Locked</span>
                             </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Popups and Modals */}
      <AnimatePresence>
        {globalError && (
          <motion.div 
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            className="fixed top-6 inset-x-6 z-[300] flex justify-center pointer-events-none"
          >
            <div className="pointer-events-auto max-w-md w-full glass-thin border border-rose-500/30 p-4 rounded-2xl shadow-2xl flex items-center gap-4 bg-rose-950/20 backdrop-blur-xl">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-black text-rose-500 uppercase tracking-widest mb-0.5">System Alert</p>
                <p className="text-xs font-bold text-white/80">{globalError}</p>
              </div>
              <button 
                onClick={() => setGlobalError(null)}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>
          </motion.div>
        )}

        {earnedBadgePopup && (
           <motion.div 
             initial={{ opacity: 0, scale: 0.8, y: 100 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.8, y: 100 }}
             className="fixed inset-x-6 bottom-12 z-[400] glass px-8 py-8 rounded-[3rem] border border-yellow-500/50 shadow-2xl flex flex-col items-center text-center gap-4 bg-slate-900/90 backdrop-blur-3xl"
           >
              <div className="w-20 h-20 bg-yellow-400 rounded-[2.5rem] flex items-center justify-center shadow-[0_0_30px_rgba(250,204,21,0.4)]">
                 {(() => {
                   const Icon = { Zap, Flame, Target, UtensilsCrossed, Trophy }[earnedBadgePopup.icon] || Star;
                   return <Icon className="w-10 h-10 text-slate-900" />;
                 })()}
              </div>
              <div>
                <h2 className="text-2xl font-black text-white mb-2">Congratulations!</h2>
                <p className="text-white/60 text-sm font-medium">You earned the <span className="text-yellow-400 font-black">{earnedBadgePopup.name}</span> badge!</p>
              </div>
              <button 
                onClick={() => setEarnedBadgePopup(null)}
                className="w-full py-4 bg-white text-slate-900 font-black rounded-2xl text-xs uppercase tracking-widest mt-4"
              >
                AWESOME!
              </button>
           </motion.div>
        )}

        {targetWeightSuccess && (
           <motion.div 
             initial={{ opacity: 0, y: 50, x: '-50%' }}
             animate={{ opacity: 1, y: 0, x: '-50%' }}
             exit={{ opacity: 0, y: 50, x: '-50%' }}
             className="fixed bottom-12 left-1/2 z-[300] glass px-6 py-4 rounded-full border border-emerald-500/50 shadow-2xl flex items-center gap-3"
           >
              <div className="w-6 h-6 bg-emerald-500/20 rounded-full flex items-center justify-center">
                 <Check className="w-3 h-3 text-emerald-400" />
              </div>
              <p className="text-sm font-black text-white">Target Weight Saved Successfully</p>
           </motion.div>
        )}

        {showCompletionMsg && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="fixed inset-0 z-[500] flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm"
          >
            <div className="glass-card p-12 rounded-[3.5rem] border border-emerald-500/30 bg-emerald-950/20 text-center max-w-sm w-full relative overflow-hidden shadow-2xl shadow-emerald-500/20">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
              <div className="flex justify-center mb-8">
                <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                </div>
              </div>
              <h2 className="text-3xl font-black mb-4">🎉 Goal Completed!</h2>
              <p className="text-white/60 font-bold mb-8 leading-relaxed">
                You've reached your daily calorie goal. Keep up the high-intensity performance!
              </p>
              <button 
                onClick={() => setShowCompletionMsg(false)}
                className="w-full py-5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black rounded-[2rem] shadow-xl active:scale-95 transition-all"
              >
                CONTINUE TRACKING
              </button>
            </div>
          </motion.div>
        )}

        {mealToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md"
          >
             <div className="glass-card p-10 rounded-[3rem] border border-rose-500/30 text-center max-w-sm w-full shadow-2xl relative overflow-hidden">
                <div className="w-16 h-16 rounded-full bg-rose-500/20 flex items-center justify-center mx-auto mb-6">
                   <Trash2 className="w-8 h-8 text-rose-500" />
                </div>
                <h3 className="text-2xl font-black mb-2">Delete Meal Record?</h3>
                <p className="text-white/60 mb-8 font-bold leading-relaxed">
                  This will permanently remove this meal from your history and statistics.
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                   onClick={() => deleteMeal(mealToDelete)}
                   className="w-full py-4 bg-rose-500 text-white font-black rounded-2xl shadow-xl shadow-rose-500/20"
                  >
                    YES, DELETE
                  </button>
                  <button 
                   onClick={() => setMealToDelete(null)}
                   className="w-full py-4 glass text-white/40 font-black rounded-2xl"
                  >
                    CANCEL
                  </button>
                </div>
             </div>
          </motion.div>
        )}

        {isEditingTargetWeight && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass p-8 rounded-[3rem] w-full max-w-sm border border-white/10 relative shadow-2xl"
            >
              <button 
                onClick={() => setIsEditingTargetWeight(false)}
                className="absolute top-6 right-6 p-2 rounded-full glass hover:bg-white/10"
              >
                <X className="w-5 h-5 text-white/40" />
              </button>

              <div className="text-center mb-8">
                 <div className="w-16 h-16 bg-cyan-500/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Target className="w-8 h-8 text-cyan-400" />
                 </div>
                 <h2 className="text-2xl font-black tracking-tight text-white">Set Target Weight</h2>
                 <p className="text-xs font-bold text-white/40 mt-2">What is your fitness goal?</p>
              </div>

              <div className="relative mb-8 flex items-center justify-center gap-2">
                  <input 
                    type="number"
                    step="0.1"
                    defaultValue={userSettings.targetWeight || 70.0}
                    id="target-weight-input-field"
                    autoFocus
                    className="w-32 py-6 bg-transparent text-5xl font-black text-white text-center focus:outline-none focus:ring-0 border-b border-white/10"
                    placeholder="00.0"
                    onFocus={(e) => e.target.select()}
                  />
                  <span className="text-lg font-black text-white/20">kg</span>
              </div>

              <button 
                onClick={async () => {
                  const val = Number((document.getElementById('target-weight-input-field') as HTMLInputElement).value);
                  if (val > 0) {
                    try {
                      await updateDoc(doc(db, 'users', user!.uid), { targetWeight: val });
                      setUserSettings(prev => ({ ...prev, targetWeight: val }));
                      setIsEditingTargetWeight(false);
                      setTargetWeightSuccess(true);
                      setTimeout(() => setTargetWeightSuccess(false), 3000);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.UPDATE, 'users');
                    }
                  }
                }}
                className="w-full py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-3xl shadow-xl shadow-cyan-500/20 active:scale-95 transition-all text-sm uppercase tracking-widest"
              >
                SAVE TARGET WEIGHT
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {mode === 'weight' && (
          <motion.div 
            key="weight"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-[60] bg-slate-950 flex flex-col p-6 overflow-y-auto no-scrollbar"
          >
            <div className="flex items-center gap-4 mb-8">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Weight Tracker</h1>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
               <div className="glass-card p-6 rounded-[2.5rem] border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Current</p>
                  <h3 className="text-3xl font-black">{weightHistory[0]?.weight || '--'} <span className="text-xs opacity-40">kg</span></h3>
               </div>
               <button 
                 onClick={() => setIsEditingTargetWeight(true)}
                 className="glass-card p-6 rounded-[2.5rem] border border-cyan-500/20 shadow-lg shadow-cyan-500/5 text-left transition-all active:scale-95"
               >
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Target</p>
                  <h3 className="text-3xl font-black">{userSettings.targetWeight || '--'} <span className="text-xs opacity-40">kg</span></h3>
               </button>
            </div>

            <div className="glass-card p-8 rounded-[3rem] mb-8 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-5">
                  <Scale className="w-32 h-32 text-emerald-500" />
               </div>
               <h3 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-6 text-center">Log Today's Weight</h3>
               <div className="relative mb-8 flex items-center justify-center gap-2">
                  <input 
                    type="number"
                    step="0.1"
                    defaultValue={weightHistory[0]?.weight || 70.0}
                    key={weightHistory[0]?.weight}
                    id="weight-input"
                    className="w-32 py-6 bg-transparent text-5xl font-black text-center focus:outline-none focus:ring-0 border-b border-white/10"
                    placeholder="00.0"
                  />
                  <span className="text-lg font-black text-white/20">kg</span>
               </div>
               <button 
                onClick={() => {
                   const val = Number((document.getElementById('weight-input') as HTMLInputElement).value);
                   if (val > 0) logWeight(val);
                }}
                className="w-full py-5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black rounded-3xl shadow-xl shadow-emerald-500/20 active:scale-95 transition-all text-sm uppercase tracking-widest"
               >
                 SAVE DAILY WEIGHT
               </button>
            </div>

            <div className="flex-1">
               <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4 px-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Weight History
               </h3>
               <div className="space-y-3 pb-24">
                 {weightHistory.map((entry) => (
                   <div key={entry.id} className="flex items-center justify-between p-4 glass rounded-3xl border border-white/5">
                      <div>
                        <p className="font-black text-sm">{entry.weight} kg</p>
                        <p className="text-[10px] font-bold text-white/30 uppercase">{format(new Date(entry.timestamp), 'MMM dd, yyyy')}</p>
                      </div>
                      <div className="text-right">
                         <p className={cn(
                           "text-[10px] font-black",
                           entry.weight > entry.targetWeight ? "text-rose-400" : "text-emerald-400"
                         )}>
                           {Math.abs(entry.weight - (userSettings.targetWeight || 70)).toFixed(1)} kg {entry.weight > (userSettings.targetWeight || 70) ? 'above' : 'below'} target
                         </p>
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          </motion.div>
        )}

        {mode === 'badges' && (
          <motion.div 
            key="badges"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-slate-950 flex flex-col p-6 overflow-y-auto no-scrollbar"
          >
            <div className="flex items-center gap-4 mb-8">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Achievements</h1>
            </div>

            <div className="grid grid-cols-2 gap-4 pb-24">
              {BADGES.map((badge) => {
                const isUnlocked = userSettings.badges?.includes(badge.id);
                const IconComponent = {
                  Zap, Flame, Target, UtensilsCrossed, Trophy
                }[badge.icon] || Star;

                return (
                  <div 
                    key={badge.id} 
                    className={cn(
                      "glass p-6 rounded-[2.5rem] flex flex-col items-center text-center gap-3 border border-white/5 relative overflow-hidden",
                      !isUnlocked && "opacity-40 grayscale"
                    )}
                  >
                    {!isUnlocked && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
                        <X className="w-8 h-8 text-white/20" />
                      </div>
                    )}
                    <div className={cn(
                      "w-16 h-16 rounded-[2rem] flex items-center justify-center mb-2 shadow-2xl",
                      isUnlocked ? badge.color : "bg-white/10"
                    )}>
                      <IconComponent className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="font-black text-sm text-white leading-tight">{badge.name}</h3>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-tighter leading-tight">
                      {badge.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
        {mode === 'meal_history' && (
          <motion.div 
            key="meal_history"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-[60] bg-slate-950 flex flex-col p-6 overflow-y-auto no-scrollbar scroll-smooth"
          >
            <div className="flex items-center gap-4 mb-8">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl active:scale-90 transition-transform"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Saved Meals</h1>
            </div>

            <div className="space-y-4 pb-24">
              {history.length === 0 ? (
                <div className="py-20 flex flex-col items-center gap-4">
                  <UtensilsCrossed className="w-12 h-12 text-white/10" />
                  <p className="text-xs font-black text-white/20 uppercase">No meals saved yet</p>
                </div>
              ) : (
                history.map((meal) => (
                  <div key={meal.id} className="glass p-4 rounded-[2.5rem] flex flex-col gap-4 border border-white/5 relative group shadow-sm">
                    <div className="flex items-center gap-4">
                      <img src={meal.imageUrl} loading="lazy" className="w-20 h-20 rounded-3xl object-cover shadow-lg" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-black text-lg line-clamp-2 break-words pr-10 leading-tight mb-1">{meal.foodName}</h4>
                        <p className="text-[10px] font-bold text-white/40 uppercase mb-2">
                          {format(new Date(meal.timestamp), 'MMM dd, yyyy • HH:mm')}
                        </p>
                        <div className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full inline-block">
                          <span className="text-[10px] font-black text-cyan-400 uppercase">{meal.calories} kcal</span>
                        </div>
                      </div>
                      <div className="absolute right-4 top-4">
                         <button 
                          onClick={() => setMealToDelete(meal.id)}
                          className="p-3 glass rounded-2xl hover:bg-rose-500/20 text-white/40 hover:text-rose-400 transition-colors"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
        {mode === 'dashboard' && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-10 flex flex-col p-6 pb-40 overflow-y-auto no-scrollbar pt-20"
          >
            {/* Brand Header */}
            <div className="flex flex-col items-center mb-12 gap-4 shrink-0 pt-4">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-blue-600 rounded-full blur opacity-25 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                {branding.logoUrl ? (
                  <img 
                    src={branding.logoUrl} 
                    className="relative w-[90px] h-[90px] object-contain drop-shadow-2xl rounded-2xl" 
                    alt="App Logo" 
                  />
                ) : (
                  <div className="relative w-[90px] h-[90px] bg-slate-900/80 backdrop-blur-xl rounded-[1.8rem] flex items-center justify-center border border-white/10 shadow-2xl overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent"></div>
                    <ImageIcon className="w-10 h-10 text-white/20" />
                    <div className="absolute inset-0 border-2 border-white/5 rounded-[1.8rem]"></div>
                  </div>
                )}
              </div>
              <div className="text-center">
                <h1 className="text-4xl font-extrabold text-white tracking-tighter uppercase italic leading-none">
                  {branding.appName?.toUpperCase().endsWith(' AI') ? (
                    <>
                      {branding.appName.substring(0, branding.appName.length - 3)} <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 not-italic">AI</span>
                    </>
                  ) : (
                    branding.appName || 'MyCalorie AI'
                  )}
                </h1>
                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] mt-2 translate-x-[0.2em]">Next Gen Tracker</p>
              </div>
            </div>

            {/* Error Message */}
            {globalError && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="mb-6 p-4 glass-thin border-l-4 border-rose-500 rounded-xl flex items-center gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                <p className="text-xs font-bold text-white/80">{globalError}</p>
                <button onClick={() => setGlobalError(null)} className="ml-auto opacity-40 hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* Completion Badge */}
            {todayCalories >= userSettings.dailyGoal && (
               <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mb-6 py-4 px-6 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-[2rem] shadow-xl flex items-center justify-between"
               >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-black text-sm text-white">Today Calories Completed</h4>
                      <p className="text-[10px] font-bold text-white/60 uppercase">Goal Reached ✅</p>
                    </div>
                  </div>
                  <div className="text-2xl">🎉</div>
               </motion.div>
            )}

            {/* Calorie Card */}
            <div className="glass-card p-8 rounded-[3rem] mb-6 relative overflow-hidden shadow-2xl shrink-0">
               <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Flame className="w-24 h-24 text-orange-500" />
               </div>
               
               <div className="flex justify-between items-end mb-6 relative z-10">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Daily Goal</span>
                    <span className="text-3xl font-black">{userSettings.dailyGoal} <span className="text-sm font-bold text-white/30">kcal</span></span>
                  </div>
                  <div className="text-right flex flex-col gap-1">
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Today</span>
                    <span className="text-3xl font-black text-cyan-400">{todayCalories} <span className="text-sm font-bold text-cyan-400/40">kcal</span></span>
                  </div>
               </div>

               {/* Progress Bar */}
               <div className="relative h-4 bg-white/5 rounded-full overflow-hidden mb-6 border border-white/5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ type: 'spring', damping: 15, stiffness: 60 }}
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-fuchsia-500 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                  />
               </div>

               <div className="flex justify-between items-center relative z-10">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", todayCalories >= userSettings.dailyGoal ? "bg-emerald-400" : "bg-cyan-400 animate-pulse")} />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white/60">
                        {calorieDiff > 0 ? (
                          `${calorieDiff} kcal remaining`
                        ) : calorieDiff < 0 ? (
                          <span className="text-rose-400">{Math.abs(calorieDiff)} kcal over</span>
                        ) : (
                          "Goal achieved!"
                        )}
                      </span>
                      {calorieDiff !== 0 && (
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter",
                          calorieDiff > 0 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        )}>
                          {calorieDiff > 0 ? 'Deficit' : 'Surplus'}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-white/30">{Math.round(progressPercent)}% Intensity</span>
               </div>
            </div>

            {/* Stats Grid: Water Tracking & Weight Tracking */}
            <div className="grid grid-cols-1 gap-6 mb-10 shrink-0">
               <div className="glass-card p-5 rounded-[2rem] flex items-center justify-between group cursor-pointer active:scale-95 transition-transform" onClick={addWater}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                      <Waves className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Water Intake</p>
                      <h4 className="font-black text-sm">{userSettings.waterIntake || 0} / {userSettings.waterGoal || 8} glasses</h4>
                    </div>
                  </div>
                  <button className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-black text-xl hover:bg-blue-500/40 transition-colors">
                    +
                  </button>
               </div>

               <div 
                className="glass-card p-5 rounded-[2rem] flex items-center justify-between group cursor-pointer active:scale-95 transition-transform"
                onClick={() => setMode('weight')}
               >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                      <Scale className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Weight Tracker</p>
                      <h4 className="font-black text-sm">
                        {weightHistory[0]?.weight || 'N/A'} <span className="opacity-40">kg</span>
                        {weightHistory.length > 0 && userSettings.targetWeight && (
                          <span className="ml-2 text-[10px] text-emerald-400">
                             ({(weightHistory[0].weight - userSettings.targetWeight).toFixed(1)} to go)
                          </span>
                        )}
                      </h4>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white transition-colors" />
               </div>

               <div 
                className="glass-card p-5 rounded-[2rem] flex items-center justify-between group cursor-pointer active:scale-95 transition-transform"
                onClick={() => setMode('meal_history')}
               >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                      <History className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Meal Records</p>
                      <h4 className="font-black text-sm">{history.length} Saved Meals</h4>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white transition-colors" />
               </div>
            </div>

            {/* Today's Meals Section */}
            <div className="flex flex-col gap-4 mb-12">
               <div className="flex items-center justify-between mb-2 px-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <div className="w-1 h-3 bg-fuchsia-500 rounded-full" />
                    Today's Meals
                  </h3>
                  <button 
                    onClick={() => setMode('history')}
                    className="text-[10px] font-black text-cyan-400 uppercase tracking-widest"
                  >
                    View All
                  </button>
               </div>

               <div className="space-y-4 pb-12">
                  {todaysMeals.length === 0 ? (
                    <div className="glass-thin p-8 rounded-[2rem] flex flex-col items-center justify-center text-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center border border-dashed border-white/20">
                        <Plus className="w-6 h-6 text-white/30" />
                      </div>
                      <p className="text-xs font-bold text-white/30 uppercase tracking-widest">No meals logged today</p>
                    </div>
                  ) : (
                    todaysMeals.map((meal) => (
                      <div key={meal.id} className="glass list-item p-3 rounded-[2rem] flex items-center gap-4 border border-white/5 shadow-sm">
                        <img src={meal.imageUrl} loading="lazy" className="w-16 h-16 rounded-[1.5rem] object-cover" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-sm line-clamp-2 break-words leading-tight">{meal.foodName}</h4>
                          <span className="text-[10px] font-bold text-white/40 uppercase">
                            {new Date(meal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-right pr-4">
                          <p className="font-black text-sm text-cyan-400">{meal.calories} kcal</p>
                          <div className="flex gap-2 justify-end">
                            <div className="w-1 h-1 rounded-full bg-blue-400/40" />
                            <div className="w-1 h-1 rounded-full bg-yellow-400/40" />
                            <div className="w-1 h-1 rounded-full bg-rose-400/40" />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
               </div>
            </div>
          </motion.div>
        )}

        {mode === 'progress' && (
          <motion.div 
            key="progress"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-10 flex flex-col p-6 overflow-y-auto no-scrollbar scroll-smooth"
          >
            <div className="flex items-center gap-4 mb-8">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl group active:scale-90 transition-all border border-white/10"
                aria-label="Go back"
              >
                <ChevronLeft className="w-6 h-6 text-white group-hover:text-cyan-400" />
              </button>
              <div className="flex-1">
                <h1 className="text-3xl font-black tracking-tight">Progress</h1>
                <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Consistency is key</p>
              </div>
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
                <button 
                  onClick={() => setChartMode('weekly')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-black transition-all",
                    chartMode === 'weekly' ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20" : "text-white/40"
                  )}
                >
                  WEEKLY
                </button>
                <button 
                  onClick={() => setChartMode('monthly')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-black transition-all",
                    chartMode === 'monthly' ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20" : "text-white/40"
                  )}
                >
                  MONTHLY
                </button>
              </div>
            </div>

            <div className="glass-card p-6 rounded-[2.5rem] border border-white/5 mb-6 h-[300px] relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-5">
                  <Activity className="w-32 h-32 text-cyan-500" />
               </div>
               
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity={1}/>
                        <stop offset="100%" stopColor="#0891b2" stopOpacity={0.2}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis 
                      dataKey="dayName" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 900 }} 
                      dy={10}
                    />
                    <YAxis hide domain={[0, 'dataMax + 500']} />
                    <Tooltip 
                      cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 10 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="glass p-3 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl">
                              <p className="text-[10px] font-black text-white/40 mb-1 uppercase tracking-widest">{payload[0].payload.date}</p>
                              <p className="text-sm font-black text-white">{payload[0].value} <span className="text-[10px] opacity-40 uppercase">kcal</span></p>
                              <div className="mt-1 pt-1 border-t border-white/5 flex items-center gap-2">
                                <Target className="w-2.5 h-2.5 text-cyan-400" />
                                <p className="text-[8px] font-black text-white/20 uppercase">Goal: {payload[0].payload.target}</p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar 
                      dataKey="calories" 
                      fill="url(#barGradient)" 
                      radius={[8, 8, 8, 8]} 
                      animationDuration={1500}
                    />
                  </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
                <motion.div 
                  whileHover={{ y: -5 }}
                  className="glass-card p-6 rounded-[2.2rem] border border-white/5 bg-white/[0.02]"
                >
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-cyan-400" />
                    Avg Intake
                  </p>
                  <h3 className="text-2xl font-black text-white">{avgCalories}<span className="text-xs text-white/20 ml-1">kcal</span></h3>
                </motion.div>
                <motion.div 
                  whileHover={{ y: -5 }}
                  className="glass-card p-6 rounded-[2.2rem] border border-white/5 bg-white/[0.02]"
                >
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Trophy className="w-3 h-3 text-emerald-400" />
                    Accuracy
                  </p>
                  <h3 className="text-2xl font-black text-white">{goalCleanRate}%</h3>
                </motion.div>
              </div>

              <div className="space-y-4 mb-24">
                <h3 className="text-xs font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Recent Progress
                </h3>
                {chartData.filter(d => d.calories > 0).slice(-5).reverse().map((day, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 glass rounded-3xl border border-white/5">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-2xl flex items-center justify-center",
                        day.calories > day.target ? "bg-rose-500/10" : "bg-emerald-500/10"
                      )}>
                        {day.calories > day.target ? <AlertTriangle className="w-5 h-5 text-rose-500" /> : <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      </div>
                      <div>
                        <p className="font-black text-sm">{day.dayName}</p>
                        <p className="text-[10px] font-bold text-white/30 uppercase">{day.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-sm">{day.calories} kcal</p>
                      <p className={cn(
                        "text-[8px] font-black uppercase tracking-widest",
                        day.calories > day.target ? "text-rose-400" : "text-emerald-400"
                      )}>
                        {day.calories > day.target ? 'Above Target' : 'Under Target'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom Nav Spacer */}
              <div className="h-24" />
          </motion.div>
        )}

        {mode === 'settings' && (
          <motion.div
            key="settings"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-50 bg-slate-950 flex flex-col p-8 overflow-y-auto no-scrollbar"
          >
            <div className="flex items-center gap-4 mb-12">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl group active:scale-90 transition-all border border-white/10"
                aria-label="Go back"
              >
                <ChevronLeft className="w-6 h-6 text-white group-hover:text-cyan-400" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Settings</h1>
            </div>

            <div className="space-y-8 flex-1">
              <section>
                <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Customize Daily Goals
                </h3>
                
                <div className="glass-card p-6 rounded-[2rem] border border-white/5 mb-6">
                  <div className="text-center mb-6">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Calorie Target</p>
                    <h2 className="text-4xl font-black text-cyan-400">{tempGoal} <span className="text-sm text-cyan-400/40">kcal</span></h2>
                  </div>

                  <input 
                    type="range"
                    min="1000"
                    max="5000"
                    step="50"
                    value={tempGoal}
                    onChange={(e) => setTempGoal(Number(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 mb-8"
                  />

                  <div className="pt-6 border-t border-white/5">
                    <div className="text-center mb-6">
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Water Target</p>
                      <h2 className="text-4xl font-black text-blue-400">{tempWaterGoal} <span className="text-sm text-blue-400/40">glasses</span></h2>
                    </div>

                    <input 
                      type="range"
                      min="4"
                      max="24"
                      step="1"
                      value={tempWaterGoal}
                      onChange={(e) => setTempWaterGoal(Number(e.target.value))}
                      className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-8"
                    />

                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Manual Water Entry</p>
                      <div className="relative">
                        <input 
                          type="number"
                          value={tempWaterGoal}
                          onChange={(e) => setTempWaterGoal(Number(e.target.value))}
                          placeholder="Glasses per day"
                          className="w-full py-4 px-6 glass rounded-2xl font-black text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                        />
                        <div className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 font-bold text-xs">GLASSES</div>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={applyGoals}
                  className="w-full py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-[2rem] shadow-2xl shadow-cyan-500/20 active:scale-95 transition-all text-lg mb-8"
                >
                  APPLY CUSTOM GOALS
                </button>

                <div className="space-y-6 pt-6 border-t border-white/5">
                  <div className="flex items-center justify-between p-6 glass rounded-[2.2rem]">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <Droplets className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-black text-sm">Water Reminders</p>
                        <p className="text-[10px] font-bold text-white/30 uppercase">Push Notifications</p>
                      </div>
                    </div>
                    <button 
                      onClick={async () => {
                        const enabled = !userSettings.waterRemindersEnabled;
                        if (enabled) {
                          if (Notification.permission === 'denied') {
                            alert("Please enable notifications to receive water reminders.");
                            return;
                          }
                          if (Notification.permission !== 'granted') {
                            const permission = await Notification.requestPermission();
                            if (permission !== 'granted') {
                              alert("Notifications are required for water reminders.");
                              return;
                            }
                          }
                        }
                        await updateDoc(doc(db, 'users', user.uid), { waterRemindersEnabled: enabled }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
                        setUserSettings(prev => ({ ...prev, waterRemindersEnabled: enabled }));
                        if (enabled) {
                          alert("Water reminders enabled 💧");
                        }
                      }}
                      className={cn(
                        "w-14 h-8 rounded-full relative transition-colors",
                        userSettings.waterRemindersEnabled ? "bg-cyan-500" : "bg-white/10"
                      )}
                    >
                      <motion.div 
                        animate={{ x: userSettings.waterRemindersEnabled ? 28 : 4 }}
                        className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg"
                      />
                    </button>
                  </div>

                  {userSettings.waterRemindersEnabled && (
                    <div className="space-y-3">
                      <div className="glass-card p-6 rounded-[2.2rem] border border-white/5">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-4">Reminder Interval</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[30, 60, 120].map((mins) => (
                            <button
                              key={mins}
                              onClick={() => {
                                updateDoc(doc(db, 'users', user.uid), { reminderInterval: mins }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
                                setUserSettings(prev => ({ ...prev, reminderInterval: mins }));
                              }}
                              className={cn(
                                "py-3 rounded-2xl font-black text-xs uppercase tracking-widest border transition-all",
                                userSettings.reminderInterval === mins 
                                  ? "bg-cyan-500/20 border-cyan-500 text-cyan-400" 
                                  : "glass border-transparent text-white/40"
                              )}
                            >
                              {mins >= 60 ? `${mins/60}hr` : `${mins}m`}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <button
                        onClick={() => {
                          if (Notification.permission === 'granted') {
                            new Notification("Time to drink water 💧", {
                              body: "Test reminder: Keep your metabolism high!",
                              icon: "/favicon.ico"
                            });
                          } else {
                            alert("Please grant notification permission first 💧");
                          }
                        }}
                        className="w-full py-4 glass rounded-3xl text-[10px] font-black uppercase tracking-widest text-cyan-400 border border-cyan-500/20 active:scale-95 transition-all"
                      >
                        Send Test Reminder
                      </button>
                    </div>
                  )}
                </div>
              </section>

                  <section className="pt-8 border-t border-white/5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                      <Scale className="w-4 h-4" />
                      Weight Goals
                    </h3>
                    <div className="glass-card p-6 rounded-[2rem] border border-white/5">
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1 text-center">Target Weight (kg)</p>
                        <div className="flex items-center justify-center gap-4">
                          <button 
                            onClick={() => {
                              const val = Math.max(30, (userSettings.targetWeight || 70) - 1);
                              updateDoc(doc(db, 'users', user!.uid), { targetWeight: val });
                              setUserSettings(prev => ({ ...prev, targetWeight: val }));
                            }}
                            className="w-10 h-10 glass rounded-full flex items-center justify-center font-black text-xl text-white hover:bg-white/10"
                          >
                            -
                          </button>
                          <h2 className="text-4xl font-black text-emerald-400">{userSettings.targetWeight || 70}</h2>
                          <button 
                            onClick={() => {
                              const val = Math.min(250, (userSettings.targetWeight || 70) + 1);
                              updateDoc(doc(db, 'users', user!.uid), { targetWeight: val });
                              setUserSettings(prev => ({ ...prev, targetWeight: val }));
                            }}
                            className="w-10 h-10 glass rounded-full flex items-center justify-center font-black text-xl text-white hover:bg-white/10"
                          >
                            +
                          </button>
                        </div>
                    </div>
                  </section>

                  <section className="pt-8 border-t border-white/5">
                    <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">Appearance</h3>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                            updateDoc(doc(db, 'users', user.uid), { theme: 'dark' });
                            setUserSettings(prev => ({ ...prev, theme: 'dark' }));
                        }}
                        className={cn(
                          "flex-1 p-6 rounded-[2rem] border transition-all flex flex-col items-center gap-2",
                          userSettings.theme === 'dark' ? "bg-slate-900 border-cyan-500 shadow-xl" : "glass border-transparent opacity-40"
                        )}
                      >
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10">
                          <Activity className="w-5 h-5 text-cyan-400" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Dark</span>
                      </button>
                      <button 
                        onClick={() => {
                            updateDoc(doc(db, 'users', user.uid), { theme: 'light' });
                            setUserSettings(prev => ({ ...prev, theme: 'light' }));
                        }}
                        className={cn(
                          "flex-1 p-6 rounded-[2rem] border transition-all flex flex-col items-center gap-2",
                          userSettings.theme === 'light' ? "bg-white border-blue-500 shadow-xl" : "glass border-transparent opacity-40"
                        )}
                      >
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                           <Activity className="w-5 h-5 text-blue-500" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Light</span>
                      </button>
                    </div>
                  </section>

                  <section className="pt-8 border-t border-white/5">
                    <div className="flex items-center justify-between mb-4">
                       <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Meal Reminders</h3>
                       <button 
                          onClick={() => {
                            const enabled = !userSettings.mealRemindersEnabled;
                            updateDoc(doc(db, 'users', user.uid), { mealRemindersEnabled: enabled });
                            setUserSettings(prev => ({ ...prev, mealRemindersEnabled: enabled }));
                          }}
                          className={cn(
                            "w-12 h-6 rounded-full relative transition-colors",
                            userSettings.mealRemindersEnabled ? "bg-emerald-500" : "bg-white/10"
                          )}
                        >
                          <motion.div animate={{ x: userSettings.mealRemindersEnabled ? 26 : 4 }} className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg" />
                       </button>
                    </div>
                    
                    {userSettings.mealRemindersEnabled && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 glass rounded-2xl">
                          <span className="text-xs font-black uppercase tracking-widest opacity-60">Breakfast</span>
                          <input 
                            type="time" 
                            value={userSettings.breakfastReminder}
                            onChange={(e) => {
                              updateDoc(doc(db, 'users', user.uid), { breakfastReminder: e.target.value });
                              setUserSettings(prev => ({ ...prev, breakfastReminder: e.target.value }));
                            }}
                            className="bg-transparent border-none font-black text-sm text-cyan-500 focus:outline-none" 
                          />
                        </div>
                         <div className="flex items-center justify-between p-4 glass rounded-2xl">
                          <span className="text-xs font-black uppercase tracking-widest opacity-60">Lunch</span>
                          <input 
                            type="time" 
                            value={userSettings.lunchReminder}
                            onChange={(e) => {
                              updateDoc(doc(db, 'users', user.uid), { lunchReminder: e.target.value });
                              setUserSettings(prev => ({ ...prev, lunchReminder: e.target.value }));
                            }}
                            className="bg-transparent border-none font-black text-sm text-cyan-500 focus:outline-none" 
                          />
                        </div>
                         <div className="flex items-center justify-between p-4 glass rounded-2xl">
                          <span className="text-xs font-black uppercase tracking-widest opacity-60">Dinner</span>
                          <input 
                            type="time" 
                            value={userSettings.dinnerReminder}
                            onChange={(e) => {
                              updateDoc(doc(db, 'users', user.uid), { dinnerReminder: e.target.value });
                              setUserSettings(prev => ({ ...prev, dinnerReminder: e.target.value }));
                            }}
                            className="bg-transparent border-none font-black text-sm text-cyan-400 focus:outline-none" 
                          />
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="pt-8 border-t border-white/5 space-y-4">
                <button 
                  onClick={() => setMode('privacy-policy')}
                  className="w-full py-5 glass border border-white/5 text-white/60 font-black rounded-3xl flex items-center justify-center gap-3 active:scale-95 transition-all"
                >
                  <Shield className="w-5 h-5" />
                  PRIVACY POLICY
                </button>
                <button 
                  onClick={() => signOut(auth)}
                  className="w-full py-5 bg-rose-500/10 border border-rose-500/20 text-rose-400 font-black rounded-3xl flex items-center justify-center gap-3"
                >
                  <LogOut className="w-5 h-5" />
                  SIGN OUT
                </button>
              </section>
            </div>
            
            <div className="mt-auto text-center opacity-20 text-[10px] font-black uppercase tracking-[0.5em] pb-8">
              AI Calorie Tracker v2.0
            </div>
          </motion.div>
        )}

        {mode === 'privacy-policy' && (
          <motion.div
            key="privacy-policy"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed inset-0 z-[60] bg-slate-950 flex flex-col"
          >
            <div className="p-8 pb-4 flex items-center gap-4">
              <button 
                onClick={() => setMode('settings')}
                className="p-3 glass rounded-2xl group active:scale-90 transition-all border border-white/10"
              >
                <ChevronLeft className="w-6 h-6 text-white group-hover:text-cyan-400" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-8 pt-4 no-scrollbar">
              <div className="glass-card p-8 rounded-[2.5rem] border border-white/5 space-y-6">
                <div>
                  <h2 className="text-xl font-black text-white mb-2">Privacy Policy for MyCalorie AI</h2>
                  <p className="text-xs font-black text-white/40 uppercase tracking-widest leading-relaxed">Last Updated: 2026</p>
                </div>

                <p className="text-white/60 font-bold leading-relaxed">
                  MyCalorie AI respects your privacy and protects your personal data.
                </p>

                <div className="space-y-4">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Information We Collect</h3>
                  <ul className="space-y-2 text-white/60 font-bold text-sm">
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      Name and Email (for login)
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      Food images scanned
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      Meal history
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      Weight and calorie data
                    </li>
                  </ul>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">How We Use Data</h3>
                  <ul className="space-y-2 text-white/60 font-bold text-sm">
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      To analyze food images
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      To calculate calories
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      To save meal history
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      To improve app performance
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Data Storage</h3>
                  <p className="text-white/60 font-bold text-sm leading-relaxed">
                    Your data is stored securely using cloud services.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Data Sharing</h3>
                  <p className="text-white/60 font-bold text-sm leading-relaxed">
                    We do not sell your data to anyone.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Security</h3>
                  <p className="text-white/60 font-bold text-sm leading-relaxed">
                    We protect your data with secure systems.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">User Rights</h3>
                  <p className="text-white/60 font-bold text-sm leading-relaxed">
                    Users can edit or delete their data anytime.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Contact</h3>
                  <p className="text-white/60 font-bold text-sm leading-relaxed">
                    support@mycalorieai.app
                  </p>
                </div>
              </div>

              <div className="h-12" />
            </div>
          </motion.div>
        )}

        {mode === 'profile' && (
          <motion.div
            key="profile"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-50 bg-slate-950 flex flex-col p-8 overflow-y-auto no-scrollbar"
          >
             <div className="flex items-center gap-4 mb-12">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-3 glass rounded-2xl"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-black tracking-tight">Your Profile</h1>
            </div>

            <div className="flex flex-col items-center mb-12">
              <div className="relative mb-6">
                {user.photoURL ? (
                  <img src={user.photoURL} className="w-32 h-32 rounded-full border-4 border-cyan-400 shadow-[0_0_40px_rgba(34,211,238,0.3)]" alt="User" />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-5xl font-black shadow-2xl">
                    {user.displayName?.[0] || 'U'}
                  </div>
                )}
                <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-emerald-500 border-4 border-slate-950" />
              </div>
              <h2 className="text-2xl font-black">{user.displayName || 'Anonymous User'}</h2>
              <p className="text-white/40 font-bold">{user.email}</p>
            </div>

            <div className="space-y-4">
              <button 
                onClick={shareApp}
                className="w-full py-6 glass rounded-[2rem] flex items-center justify-between px-8 group active:scale-95 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                    <Share2 className="w-5 h-5 text-cyan-400" />
                  </div>
                  <span className="font-black">Invite Friends</span>
                </div>
                <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-cyan-400 transition-colors" />
              </button>

              <button 
                onClick={() => setMode('settings')}
                className="w-full py-6 glass rounded-[2rem] flex items-center justify-between px-8 group active:scale-95 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <SettingsIcon className="w-5 h-5 text-indigo-400" />
                  </div>
                  <span className="font-black">App Settings</span>
                </div>
                <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-indigo-400 transition-colors" />
              </button>

              {isAdmin && (
               <section className="mt-8 mb-8">
                 <h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                   <ImageIcon className="w-4 h-4" />
                   Admin Branding Control
                 </h3>
 
                 <div className="glass-card p-10 rounded-[3.5rem] border border-white/5 text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="flex flex-col items-center gap-8 relative z-10">
                       <div className="relative">
                         <div className="absolute -inset-2 bg-gradient-to-r from-cyan-400 to-blue-600 rounded-[2rem] blur opacity-20"></div>
                         {branding.logoUrl ? (
                           <img 
                             src={branding.logoUrl} 
                             className="relative w-[90px] h-[90px] object-contain drop-shadow-2xl rounded-2xl" 
                             alt="App Logo" 
                           />
                         ) : (
                           <div className="relative w-[90px] h-[90px] bg-white/5 rounded-[1.8rem] flex items-center justify-center border border-white/10 group-hover:border-cyan-500/30 transition-all shadow-inner">
                              <ImageIcon className="w-10 h-10 text-white/5 group-hover:text-cyan-400/20 transition-all" />
                           </div>
                         )}
                         <label 
                           htmlFor="logo-upload"
                           className="absolute -bottom-2 -right-2 p-4 bg-gradient-to-tr from-cyan-400 to-blue-600 rounded-3xl shadow-xl cursor-pointer hover:scale-110 active:scale-95 transition-all ring-4 ring-slate-950"
                         >
                           <UploadCloud className="w-5 h-5 text-white" />
                         </label>
                         <input 
                           id="logo-upload"
                           type="file"
                           accept=".png,.jpg,.jpeg"
                           className="hidden"
                           onChange={handleLogoUpload}
                         />
                       </div>
                       
                       <div className="space-y-4 w-full">
                         <div className="flex flex-col gap-2">
                           <label className="text-[10px] font-black text-white/40 uppercase tracking-widest text-left px-2">App Name</label>
                           <input 
                              type="text"
                              value={rebrandingName}
                              onChange={(e) => setRebrandingName(e.target.value)}
                              onBlur={handleAppNameUpdate}
                              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 font-black transition-all focus:border-cyan-500/50 outline-none"
                              placeholder="App Name"
                           />
                         </div>
                         <p className="text-[10px] font-black text-white/30 uppercase tracking-widest max-w-[200px] mx-auto leading-relaxed">Only you (Admin) can see and modify these branding settings.</p>
                       </div>
 
                       {branding.logoUrl && (
                         <button 
                           onClick={async () => {
                             try {
                               await updateDoc(doc(db, 'appConfig', 'branding'), { logoUrl: null });
                               setBranding(prev => ({ ...prev, logoUrl: null }));
                             } catch (e) {
                               handleFirestoreError(e, OperationType.UPDATE, 'appConfig/branding');
                             }
                           }}
                           className="px-6 py-2 rounded-full border border-rose-500/20 text-[10px] font-black text-rose-400 uppercase tracking-[0.2em] hover:bg-rose-500/10 transition-all"
                         >
                           Reset Logo
                         </button>
                       )}
                    </div>
                 </div>
               </section>
              )}

              <button 
                onClick={() => signOut(auth)}
                className="w-full py-6 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/20 rounded-[2rem] flex items-center justify-center gap-3 mt-8 transition-colors active:scale-95"
              >
                <LogOut className="w-5 h-5 text-rose-500" />
                <span className="font-black text-rose-500">Log Out safely</span>
              </button>
            </div>

            <div className="mt-12 p-6 glass-thin rounded-[2rem] border border-white/5 flex items-center gap-4">
              <Info className="w-6 h-6 text-white/20 shrink-0" />
              <p className="text-[10px] font-bold text-white/40 leading-relaxed uppercase tracking-widest">
                Your data is securely stored and synchronized across all your devices using advanced cloud encryption.
              </p>
            </div>
          </motion.div>
        )}

        {mode === 'scan' && (
          <motion.div 
            key="scan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-10"
          >
            {/* Header */}
            <div className="absolute top-0 inset-x-0 p-6 flex justify-between items-center z-20 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <button 
                  onClick={() => setMode('dashboard')}
                  className="p-2 glass rounded-full text-white"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>
              <div className="pointer-events-auto">
                <button className="p-2 glass rounded-full text-white">
                  <Zap className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Camera View */}
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {cameraError && (
              <div className="absolute inset-0 z-30 bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
                  <Camera className="w-10 h-10 text-red-400" />
                </div>
                <h2 className="text-3xl font-black mb-4 tracking-tight">Camera Blocked</h2>
                <p className="text-white/50 text-sm mb-10 leading-relaxed max-w-xs">
                  Browser security often blocks camera access in previews. You can open in a new tab or use your gallery.
                </p>
                <div className="flex flex-col gap-4 w-full max-w-xs">
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="w-full py-4 bg-white text-black font-black rounded-3xl shadow-xl shadow-white/10 active:scale-95 transition-transform"
                  >
                    OPEN IN NEW TAB
                  </button>
                  <label className="w-full py-4 glass text-white font-black rounded-3xl cursor-pointer active:scale-95 transition-transform">
                    PICK FROM GALLERY
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const dataUrl = ev.target?.result as string;
                            setCapturedImage(dataUrl);
                            setMode('analyze');
                            analyzeFoodImage(dataUrl.split(',')[1])
                              .then(res => {
                                setNutrition(res);
                                setMode('result');
                              })
                              .catch(() => {
                                setMode('scan');
                                alert("AI Processing Failed");
                              });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
            
            {/* Scan Overlay */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6">
              <div className="relative w-full aspect-square max-w-sm rounded-[2.5rem] border-2 border-white/30 overflow-hidden">
                <div className="absolute inset-0 bg-transparent flex flex-col items-center justify-center">
                  <motion.div 
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-white/50 to-transparent blur-sm z-20"
                  />
                  
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                </div>
              </div>
              
              <div className="mt-8 text-white/80 text-sm font-bold tracking-widest flex items-center gap-2 px-4 py-2 glass-thin rounded-full uppercase">
                <Search className="w-4 h-4 text-cyan-400" />
                Scanning Field
              </div>
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-0 inset-x-0 p-8 flex justify-between items-center z-20">
              <button 
                onClick={() => setMode('history')}
                className="w-12 h-12 flex items-center justify-center glass rounded-2xl text-white overflow-hidden"
              >
                {history.length > 0 ? (
                  <img src={history[0].imageUrl} className="w-full h-full object-cover opacity-60" />
                ) : (
                  <History className="w-6 h-6" />
                )}
              </button>
              
              <button 
                onClick={handleCapture}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.3)] p-1 transition-transform active:scale-90"
              >
                <div className="w-full h-full border-2 border-black/10 rounded-full flex items-center justify-center">
                  <div className="w-16 h-16 bg-stone-900 rounded-full" />
                </div>
              </button>
              
              <label className="w-12 h-12 flex items-center justify-center glass rounded-2xl text-white cursor-pointer transition-colors active:bg-white/20">
                <Plus className="w-6 h-6" />
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        )}

        {mode === 'analyze' && (
          <motion.div 
            key="analyze" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 p-6"
          >
            <div className="w-full max-w-sm flex flex-col items-center">
              <div className="relative w-full aspect-square mb-12 flex items-center justify-center">
                <motion.div 
                  className="absolute inset-0 border-2 border-cyan-400 rounded-[3rem]"
                  animate={{ opacity: [0.2, 0.5, 0.2], scale: [1, 1.02, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <img src={capturedImage!} className="w-[80%] aspect-square object-cover rounded-[2.5rem] opacity-50 grayscale" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                     <Loader2 className="w-16 h-16 animate-spin text-cyan-400" />
                     <motion.div 
                      className="absolute inset-0 bg-cyan-400/20 blur-xl rounded-full"
                      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0.2, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                     />
                  </div>
                </div>
              </div>
              <h2 className="text-2xl font-black mb-2 animate-pulse tracking-tight text-white">Analyzing Food...</h2>
              <p className="text-white/40 font-bold uppercase tracking-[0.2em] text-[10px]">Gemini AI Vision Performance</p>
            </div>
          </motion.div>
        )}

        {mode === 'result' && nutrition && (
          <motion.div 
            key="result"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 backdrop-blur-xl"
          >
            {/* Top Image Preview */}
            <div className="relative h-1/3 w-full">
              <img src={capturedImage!} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />
              <button 
                onClick={() => setMode('scan')}
                className="absolute top-6 left-6 p-2 glass rounded-full shadow-lg"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div className="absolute bottom-6 left-8 right-8">
                <div className="flex items-center gap-2 mb-2">
                   <div className="h-px bg-cyan-400 flex-1" />
                   <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">Scan Complete</span>
                </div>
                <h1 className="text-4xl font-black tracking-tight line-clamp-2 break-words leading-tight">{nutrition.foodName}</h1>
              </div>
            </div>

            {/* Results Content */}
            <div className="flex-1 bg-white/10 backdrop-blur-3xl border-t border-white/20 rounded-t-[3rem] p-8 -mt-8 shadow-2xl overflow-y-auto no-scrollbar relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                  <div className="flex items-center gap-2 bg-orange-500/20 text-orange-400 px-4 py-2 rounded-xl text-sm font-black border border-orange-500/30">
                    <Flame className="w-4 h-4 fill-current" />
                    {nutrition.calories} KCAL
                  </div>
                  <button 
                    onClick={() => {
                      setCorrectionValue(nutrition.calories);
                      setCorrectionProtein(nutrition.protein);
                      setCorrectionCarbs(nutrition.carbs);
                      setCorrectionFat(nutrition.fat);
                      setIsCorrecting(true);
                    }}
                    className="flex items-center gap-2 bg-purple-500/20 text-purple-400 px-4 py-2 rounded-xl text-[10px] font-black border border-purple-500/30 uppercase tracking-tight active:scale-95 transition-all"
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit
                  </button>
                  {nutrition.estimatedPortion && (
                    <div className="flex items-center gap-2 bg-cyan-500/20 text-cyan-400 px-4 py-2 rounded-xl text-[10px] font-black border border-cyan-500/30 uppercase tracking-tight">
                      <UtensilsCrossed className="w-3 h-3" />
                      {nutrition.estimatedPortion}
                    </div>
                  )}
                  <button 
                    onClick={() => {
                      setCorrectionValue(nutrition.calories);
                      setCorrectionProtein(nutrition.protein);
                      setCorrectionCarbs(nutrition.carbs);
                      setCorrectionFat(nutrition.fat);
                      setIsCorrecting(true);
                    }}
                    className="flex items-center gap-2 bg-purple-500/20 text-purple-400 px-4 py-2 rounded-xl text-[10px] font-black border border-purple-500/30 uppercase tracking-tight"
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit Nutrition
                  </button>
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Result View</p>
              </div>
              
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 mb-8 italic text-white/70 text-sm leading-relaxed">
                "{nutrition.description}"
              </div>

              {/* Enhanced Macros Grid */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="glass-thin p-4 rounded-3xl flex flex-col gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Protein</span>
                  <div className="flex items-end gap-2 text-white">
                    <span className="text-2xl font-black">{nutrition.protein}</span>
                    <span className="text-xs font-bold text-white/30 mb-1">grams</span>
                  </div>
                  <div className="w-full h-1.5 bg-blue-500/20 rounded-full mt-2 overflow-hidden">
                    <motion.div initial={{width:0}} animate={{width: '60%'}} className="h-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]" />
                  </div>
                </div>
                <div className="glass-thin p-4 rounded-3xl flex flex-col gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Carbs</span>
                  <div className="flex items-end gap-2 text-white">
                    <span className="text-2xl font-black">{nutrition.carbs}</span>
                    <span className="text-xs font-bold text-white/30 mb-1">grams</span>
                  </div>
                  <div className="w-full h-1.5 bg-yellow-500/20 rounded-full mt-2 overflow-hidden">
                    <motion.div initial={{width:0}} animate={{width: '40%'}} className="h-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]" />
                  </div>
                </div>
                <div className="glass-thin p-4 rounded-3xl flex flex-col gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Fat</span>
                  <div className="flex items-end gap-2 text-white">
                    <span className="text-2xl font-black">{nutrition.fat}</span>
                    <span className="text-xs font-bold text-white/30 mb-1">grams</span>
                  </div>
                  <div className="w-full h-1.5 bg-rose-500/20 rounded-full mt-2 overflow-hidden">
                    <motion.div initial={{width:0}} animate={{width: '30%'}} className="h-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]" />
                  </div>
                </div>
                <div className="glass-thin p-4 rounded-3xl flex flex-col gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Fiber</span>
                  <div className="flex items-end gap-2 text-white">
                    <span className="text-2xl font-black">{nutrition.fiber || 0}</span>
                    <span className="text-xs font-bold text-white/30 mb-1">grams</span>
                  </div>
                  <div className="w-full h-1.5 bg-emerald-500/20 rounded-full mt-2 overflow-hidden">
                    <motion.div initial={{width:0}} animate={{width: '50%'}} className="h-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                  </div>
                </div>
              </div>

              {/* AI Feedback / Correction System */}
              <div className="glass-card p-6 rounded-[2.5rem] border border-white/5 mb-8 shadow-2xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Accuracy Check</p>
                  </div>
                  {feedbackSuccess && <span className="text-[10px] font-black text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> FEEDBACK RECEIVED</span>}
                </div>
                
                {!feedbackSuccess ? (
                  <>
                    <h4 className="font-black text-sm text-white mb-6">Was this calorie and nutrition result accurate?</h4>
                    {isCorrecting ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <div className="space-y-4">
                          <div className="relative">
                            <label className="text-[10px] font-black text-white/20 uppercase absolute left-6 top-3">Correct Calories*</label>
                            <input 
                              type="number"
                              value={correctionValue}
                              onChange={(e) => setCorrectionValue(e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-full pt-8 pb-4 px-6 glass rounded-2xl font-black text-2xl text-cyan-400 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
                              placeholder="KCAL"
                            />
                            <span className="absolute right-6 bottom-4 text-[10px] font-black text-white/20">REQUIRED</span>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                             <div className="relative">
                               <label className="text-[8px] font-black text-white/20 uppercase absolute left-3 top-2">Protein</label>
                               <input 
                                 type="number"
                                 value={correctionProtein}
                                 onChange={(e) => setCorrectionProtein(e.target.value === '' ? '' : Number(e.target.value))}
                                 className="w-full pt-6 pb-2 px-3 glass rounded-xl font-bold text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none text-center"
                                 placeholder="g"
                               />
                             </div>
                             <div className="relative">
                               <label className="text-[8px] font-black text-white/20 uppercase absolute left-3 top-2">Carbs</label>
                               <input 
                                 type="number"
                                 value={correctionCarbs}
                                 onChange={(e) => setCorrectionCarbs(e.target.value === '' ? '' : Number(e.target.value))}
                                 className="w-full pt-6 pb-2 px-3 glass rounded-xl font-bold text-sm text-white focus:ring-1 focus:ring-yellow-500/50 outline-none text-center"
                                 placeholder="g"
                               />
                             </div>
                             <div className="relative">
                               <label className="text-[8px] font-black text-white/20 uppercase absolute left-3 top-2">Fat</label>
                               <input 
                                 type="number"
                                 value={correctionFat}
                                 onChange={(e) => setCorrectionFat(e.target.value === '' ? '' : Number(e.target.value))}
                                 className="w-full pt-6 pb-2 px-3 glass rounded-xl font-bold text-sm text-white focus:ring-1 focus:ring-rose-500/50 outline-none text-center"
                                 placeholder="g"
                               />
                             </div>
                          </div>
                        </div>

                        {feedbackError && (
                          <motion.p 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-red-400 text-[10px] font-black text-center uppercase tracking-widest"
                          >
                            {feedbackError}
                          </motion.p>
                        )}

                        <div className="flex gap-3 pt-2">
                           <button onClick={() => { setIsCorrecting(false); setFeedbackError(null); }} className="flex-1 py-4 glass rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors">Cancel</button>
                           <button onClick={() => submitFeedback(false)} className="flex-1 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] text-white shadow-xl shadow-cyan-500/20">Submit Correction</button>
                        </div>

                        <div className="pt-4 border-t border-white/5 space-y-4">
                          <div className="relative">
                            <label className="text-[10px] font-black text-white/20 uppercase absolute left-6 top-3">AI Re-analyze Hint (Optional)</label>
                            <input 
                              type="text"
                              value={reAnalysisHint}
                              onChange={(e) => setReAnalysisHint(e.target.value)}
                              className="w-full pt-8 pb-4 px-6 glass rounded-2xl font-bold text-sm text-white focus:ring-2 focus:ring-purple-500/50 outline-none"
                              placeholder="e.g., 'There are 2 items, not 1'"
                            />
                          </div>
                          <button 
                            onClick={handleReAnalyze}
                            disabled={isReAnalyzing}
                            className="w-full py-4 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] text-white shadow-xl shadow-purple-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            {isReAnalyzing ? (
                              <>
                                <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                RE-ANALYZING...
                              </>
                            ) : (
                              <>
                                <RotateCcw className="w-3 h-3" />
                                LET AI TRY AGAIN
                              </>
                            )}
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="flex gap-3">
                        <button 
                          onClick={() => submitFeedback(true)}
                          className="flex-1 py-5 glass hover:bg-emerald-500/10 border border-emerald-500/5 rounded-3xl font-black text-xs uppercase tracking-[0.2em] text-emerald-400 transition-all active:scale-95 flex flex-col items-center gap-1"
                        >
                          <Check className="w-4 h-4" />
                          YES (Accurate)
                        </button>
                        <button 
                          onClick={() => { setIsCorrecting(true); setCorrectionValue(nutrition.calories); }}
                          className="flex-1 py-5 glass hover:bg-rose-500/10 border border-rose-500/5 rounded-3xl font-black text-xs uppercase tracking-[0.2em] text-rose-400 transition-all active:scale-95 flex flex-col items-center gap-1"
                        >
                          <X className="w-4 h-4" />
                          NO (Incorrect)
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center justify-center p-4 text-center"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-500 border-4 border-emerald-500/20 flex items-center justify-center mb-4">
                      <Check className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-xs font-black text-white uppercase tracking-widest leading-relaxed">
                      Thank you for your feedback!
                    </p>
                  </motion.div>
                )}
              </div>

              {/* Micronutrients / Breakdown */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-cyan-400 mb-4 flex items-center gap-2">
                    <div className="w-1 h-3 bg-cyan-400 rounded-full" />
                    Ingredients
                  </h3>
                  <div className="space-y-2">
                    {nutrition.ingredients.map((ing, i) => (
                      <div key={i} className="text-xs font-medium text-white/60 flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-white/20" />
                        {ing}
                      </div>
                    ))}
                  </div>
                </div>
                {nutrition.micronutrients && nutrition.micronutrients.length > 0 && (
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-fuchsia-400 mb-4 flex items-center gap-2">
                      <div className="w-1 h-3 bg-fuchsia-400 rounded-full" />
                      Micros
                    </h3>
                    <div className="space-y-3">
                      {nutrition.micronutrients.map((micro, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-white/60">{micro.name}</span>
                            <span className="text-fuchsia-300">{micro.value}</span>
                          </div>
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full w-2/3 bg-fuchsia-500/40" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Add Button */}
              <button 
                onClick={saveMeal}
                disabled={isSaving}
                className={cn(
                  "w-full py-5 rounded-[2rem] font-black text-lg shadow-2xl transition-all flex items-center justify-center gap-3 group active:scale-95",
                  isSaving 
                    ? "bg-white/10 cursor-not-allowed text-white/40 border border-white/5" 
                    : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-blue-500/20"
                )}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                    <span>SAVING LOG...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" />
                    <span>LOG MEAL</span>
                  </>
                )}
              </button>
              
              <div className="mt-8 pt-8 border-t border-white/10 flex items-center justify-center gap-6 opacity-40">
                <span className="text-[10px] font-bold tracking-widest">© 2024 GEMINI VISION</span>
                <span className="text-[10px] font-bold tracking-widest">•</span>
                <span className="text-[10px] font-bold tracking-widest">ESTIMATION MODE</span>
              </div>
            </div>
          </motion.div>
        )}

          {mode === 'history' && (
          <motion.div 
            key="history"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) setMode('dashboard');
            }}
            className="fixed inset-0 z-50 flex flex-col bg-slate-950"
          >
            <div className="p-6 flex items-center justify-between glass border-b border-white/10 bg-black/40 backdrop-blur-3xl sticky top-0 z-20">
              <button 
                onClick={() => setMode('dashboard')}
                className="p-2 hover:bg-white/10 rounded-full transition-colors group"
                aria-label="Go back"
              >
                <ChevronLeft className="w-6 h-6 text-white group-hover:text-cyan-400" />
              </button>
              <h2 className="text-xl font-black tracking-tight text-white">Daily Calorie Chart</h2>
              <div className="w-10" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 no-scrollbar flex flex-col items-center">
               <div className="w-full glass-card p-6 md:p-8 rounded-[2.5rem] border border-white/5 bg-white/[0.02]">
                 <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-cyan-400" />
                      <h3 className="text-xs font-black uppercase tracking-widest text-white/60">7-Day Calorie Trends</h3>
                    </div>
                    {history.length === 0 && <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest px-2 py-0.5 bg-orange-400/10 rounded-lg">Demo Mode</span>}
                 </div>
                 
                 <div className="h-48 w-full">
                   <ResponsiveContainer width="100%" height="100%">
                     <LineChart data={(() => {
                       const chartData = [];
                       const hasRealData = history.length > 0;
                       const demoData: Record<string, number> = {
                         'Mon': 1800, 'Tue': 1950, 'Wed': 2100, 'Thu': 1700, 'Fri': 2000, 'Sat': 1850, 'Sun': 2200
                       };

                       for (let i = 6; i >= 0; i--) {
                         const dateObj = subDays(startOfDay(new Date()), i);
                         const dateStr = format(dateObj, 'yyyy-MM-dd');
                         const dayName = format(dateObj, 'EEE');
                         
                         let calories = history
                           .filter(h => h.date === dateStr)
                           .reduce((sum, h) => sum + (h.calories || 0), 0);
                         
                         if (!hasRealData) {
                           calories = demoData[dayName] || 1500;
                         }

                         chartData.push({ name: dayName, calories });
                       }
                       return chartData;
                     })()}>
                       <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                       <XAxis 
                         dataKey="name" 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 900 }} 
                         dy={10}
                       />
                       <YAxis 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 900 }}
                         dx={-10}
                         domain={[0, 'auto']}
                         ticks={[1000, 1500, 2000, 2500]}
                       />
                       <Tooltip 
                         contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }} 
                         itemStyle={{ color: '#22d3ee', fontSize: '12px', fontWeight: 900 }}
                         labelStyle={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', fontWeight: 900, marginBottom: '4px' }}
                         cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                       />
                       <Line 
                         type="monotone" 
                         dataKey="calories" 
                         stroke="#22d3ee" 
                         strokeWidth={3} 
                         dot={{ r: 4, fill: '#22d3ee', strokeWidth: 2, stroke: '#0f172a' }}
                         activeDot={{ r: 6, fill: '#fff', strokeWidth: 0 }}
                       />
                     </LineChart>
                   </ResponsiveContainer>
                 </div>
               </div>

               <div className="space-y-4 pt-4">
                 <h3 className="text-[10px] font-black uppercase tracking-widest text-white/30 px-4">Detailed Logs</h3>
                 {history.length === 0 ? (
                 <div className="flex flex-col items-center justify-center p-20 opacity-20">
                   <History className="w-12 h-12 mb-4" />
                   <p className="font-black uppercase text-xs">No History Found</p>
                 </div>
               ) : (
                 history.map((meal) => (
                  <motion.div 
                    layoutId={meal.id}
                    key={meal.id} 
                    className="glass-card p-4 rounded-[2.5rem] flex gap-4 transition-transform active:scale-[0.98]"
                  >
                    <div className="relative group">
                      <img src={meal.imageUrl} className="w-20 h-20 rounded-3xl object-cover border border-white/10" />
                      <div className="absolute inset-0 bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Search className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-4">
                        <h3 className="font-black text-lg leading-tight tracking-tight line-clamp-2 break-words flex-1">{meal.foodName}</h3>
                        <div className="flex items-center gap-1 text-orange-400 font-black text-sm shrink-0">
                          <Flame className="w-3 h-3 fill-current" />
                          {meal.calories}
                        </div>
                      </div>
                      <div className="flex justify-between items-end mt-2">
                        <div className="flex gap-4">
                          <div className="flex flex-col">
                            <span className="text-[8px] text-white/30 font-black uppercase">P</span>
                            <span className="text-xs font-black">{meal.protein}g</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] text-white/30 font-black uppercase">C</span>
                            <span className="text-xs font-black">{meal.carbs}g</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] text-white/30 font-black uppercase">F</span>
                            <span className="text-xs font-black">{meal.fat}g</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => shareMealLink(meal.id)}
                          className="p-2 glass rounded-xl text-white/40 hover:text-cyan-400 transition-colors"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
              </div>
            </div>
            
            {/* History Footer */}
            <div className="p-8 pb-12 flex justify-center opacity-20 bg-gradient-to-t from-black to-transparent">
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">End of History</span>
            </div>
          </motion.div>
        )}
      {/* Global Bottom Navigation */}
      {['dashboard', 'progress', 'meal_history', 'profile', 'badges', 'weight', 'meal_records'].includes(mode) && (
        <div className="fixed bottom-0 inset-x-0 p-6 z-50 pointer-events-none">
          <div className="max-w-md mx-auto pointer-events-auto">
            <div className="glass rounded-[2rem] p-2 flex items-center justify-around shadow-2xl border border-white/10 backdrop-blur-2xl">
               <button 
                onClick={() => setMode('dashboard')}
                className={cn(
                  "p-4 rounded-2xl transition-all active:scale-90",
                  mode === 'dashboard' ? "text-cyan-400 bg-cyan-400/10" : "text-white/40"
                )}
               >
                 <Zap className={cn("w-6 h-6", mode === 'dashboard' && "fill-current")} />
               </button>

               <button 
                onClick={() => setMode('progress')}
                className={cn(
                  "p-4 rounded-2xl transition-all active:scale-90",
                  mode === 'progress' ? "text-cyan-400 bg-cyan-400/10" : "text-white/40"
                )}
               >
                 <BarChartIcon className="w-6 h-6" />
               </button>

               <button 
                onClick={() => setMode('scan')}
                className="p-5 bg-gradient-to-tr from-cyan-400 to-blue-600 rounded-full shadow-lg shadow-cyan-500/20 text-white active:scale-90 transition-all -translate-y-4 border-4 border-slate-950"
               >
                 <Camera className="w-8 h-8" />
               </button>

               <button 
                onClick={() => setMode('meal_history')}
                className={cn(
                  "p-4 rounded-2xl transition-all active:scale-90",
                  mode === 'meal_history' ? "text-cyan-400 bg-cyan-400/10" : "text-white/40"
                )}
               >
                 <History className="w-6 h-6" />
               </button>

               <button 
                onClick={() => setMode('profile')}
                className={cn(
                  "p-4 rounded-2xl transition-all active:scale-90",
                  mode === 'profile' ? "text-cyan-400 bg-cyan-400/10" : "text-white/40"
                )}
               >
                 <UserIcon className="w-6 h-6" />
               </button>
            </div>
          </div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}

