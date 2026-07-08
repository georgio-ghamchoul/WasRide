export type LocaleCode = "en" | "ar";

const dictionary = {
  en: {
    account: "My account",
    profile: "Profile",
    adminDashboard: "Admin dashboard",
    signOut: "Sign out",
    gettingLocation: "Getting your location...",
    confirmPickup: "Confirm pickup",
    confirmDestination: "Confirm destination",
    movePickup: "Move map to set pickup",
    moveDestination: "Move map to set destination",
    passengerProfile: "Passenger profile",
    driverProfile: "Driver profile",
    loadingProfile: "Loading your account...",
    saveProfile: "Save profile",
    driverHomeOnline: "You are online",
    driverHomeOffline: "You are offline",
    goOnline: "Go online",
    goOffline: "Go offline",
    tripCompleted: "Trip completed",
    rateTrip: "Rate trip",
    submitRating: "Submit rating",
  },
  ar: {
    account: "حسابي",
    profile: "الملف الشخصي",
    adminDashboard: "لوحة الإدارة",
    signOut: "تسجيل الخروج",
    gettingLocation: "جاري تحديد موقعك...",
    confirmPickup: "تأكيد نقطة الانطلاق",
    confirmDestination: "تأكيد الوجهة",
    movePickup: "حرّك الخريطة لتحديد نقطة الانطلاق",
    moveDestination: "حرّك الخريطة لتحديد الوجهة",
    passengerProfile: "ملف الراكب",
    driverProfile: "ملف السائق",
    loadingProfile: "جاري تحميل الحساب...",
    saveProfile: "حفظ الملف",
    driverHomeOnline: "أنت متصل الآن",
    driverHomeOffline: "أنت غير متصل",
    goOnline: "اتصل الآن",
    goOffline: "إيقاف الاتصال",
    tripCompleted: "اكتملت الرحلة",
    rateTrip: "قيّم الرحلة",
    submitRating: "إرسال التقييم",
  },
} as const;

export function t(locale: LocaleCode, key: keyof (typeof dictionary)["en"]) {
  return dictionary[locale][key] ?? dictionary.en[key];
}
