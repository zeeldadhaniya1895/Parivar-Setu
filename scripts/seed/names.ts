// Synthetic name and place pools. Latin script only. All people are fictional.

export type Gender = "M" | "F";

/** The ~30 common Gujarati surnames from DESIGN.md 7.1, weighted so Patel dominates. */
export const SURNAMES: readonly (readonly [string, number])[] = [
  ["Patel", 24], ["Chaudhary", 12], ["Thakor", 8], ["Shah", 6], ["Desai", 6],
  ["Parmar", 6], ["Prajapati", 6], ["Solanki", 4], ["Rathod", 4], ["Chauhan", 3],
  ["Joshi", 3], ["Mehta", 2], ["Trivedi", 2], ["Pandya", 2], ["Bhatt", 2],
  ["Vaghela", 3], ["Makwana", 2], ["Gohil", 2], ["Jadeja", 2], ["Zala", 2],
  ["Dave", 2], ["Vyas", 1], ["Raval", 2], ["Panchal", 3], ["Soni", 2],
  ["Mistry", 2], ["Barot", 2], ["Rabari", 3], ["Bharwad", 3], ["Modi", 2],
];

export const MALE_OLD: readonly string[] = [
  "Kantilal", "Chandrakant", "Hasmukh", "Natwar", "Mohan", "Ishwar", "Bhikha", "Ramesh",
  "Suresh", "Mahesh", "Dinesh", "Prakash", "Vijay", "Ashok", "Kirit", "Bharat", "Naresh",
  "Pravin", "Vinod", "Arvind", "Girish", "Haresh", "Jitendra", "Lalit", "Dahya", "Mafat",
];

export const MALE_MID: readonly string[] = [
  "Rajesh", "Jayesh", "Nilesh", "Hitesh", "Bhavesh", "Ketan", "Paresh", "Manish", "Dhaval",
  "Jignesh", "Kalpesh", "Rakesh", "Mukesh", "Manoj", "Nitin", "Pankaj", "Sanjay", "Vishal",
  "Ajay", "Amit", "Chirag", "Darshan", "Tejas", "Kaushik", "Jatin", "Alpesh", "Chetan",
  "Mehul", "Sandip", "Vipul",
];

export const MALE_YOUNG: readonly string[] = [
  "Yash", "Dev", "Meet", "Harsh", "Jay", "Parth", "Smit", "Jenil", "Het", "Dhruv", "Krish",
  "Rohan", "Aryan", "Om", "Kunal", "Raj", "Nisarg", "Vansh", "Ved", "Darsh",
];

export const FEMALE_OLD: readonly string[] = [
  "Savita", "Kokila", "Kanta", "Shanta", "Manjula", "Hansa", "Lata", "Usha", "Nirmala",
  "Bhanu", "Chandra", "Kamla", "Pushpa", "Ramila", "Jasoda", "Gauri", "Sita", "Leela", "Vimla",
];

export const FEMALE_MID: readonly string[] = [
  "Sunita", "Rekha", "Meena", "Geeta", "Kiran", "Nita", "Jyoti", "Hetal", "Bhavna", "Komal",
  "Dipika", "Rupal", "Varsha", "Ami", "Falguni", "Sejal", "Pinal", "Heena", "Mital", "Nayna",
];

export const FEMALE_YOUNG: readonly string[] = [
  "Pooja", "Priya", "Krisha", "Riya", "Khushi", "Nidhi", "Dhara", "Kinjal", "Foram", "Hiral",
  "Jinal", "Mansi", "Nisha", "Disha", "Kavya", "Anjali", "Zalak", "Bhumi", "Ishita", "Aarohi",
  "Jiya", "Vaidehi", "Aditi", "Shreya",
];

/** Pick the name pool that fits a birth year. */
export function firstNamePool(gender: Gender, birthYear: number): readonly string[] {
  if (gender === "M") {
    if (birthYear < 1975) return MALE_OLD;
    return birthYear < 2000 ? MALE_MID : MALE_YOUNG;
  }
  if (birthYear < 1975) return FEMALE_OLD;
  return birthYear < 2000 ? FEMALE_MID : FEMALE_YOUNG;
}

export interface Geo {
  district: string;
  taluka: string;
  villages: string[];
}

export const TALUKAS: readonly (readonly [district: string, taluka: string])[] = [
  ["Mehsana", "Mehsana"], ["Mehsana", "Visnagar"], ["Mehsana", "Kadi"],
  ["Anand", "Anand"], ["Anand", "Petlad"], ["Anand", "Borsad"],
  ["Banaskantha", "Palanpur"], ["Banaskantha", "Deesa"], ["Banaskantha", "Dhanera"],
];

export const VILLAGE_POOL: readonly string[] = [
  "Ambaliyasan", "Bhandu", "Dediyasan", "Lakhwad", "Kukas", "Rangakui", "Mokhasan", "Dhinoj",
  "Kansa", "Sobhasan", "Rajpur", "Unava", "Malekpur", "Khadalpur", "Ladol", "Jotana",
  "Bechraji", "Dabhoda", "Sander", "Karannagar", "Vasai", "Kherva", "Ganpat", "Memadpur",
  "Sarsav", "Nandasan", "Thol", "Sardhav", "Boriavi", "Napad", "Sunav", "Vadod", "Ras",
  "Sarsa", "Ode", "Dharmaj", "Vaso", "Nar", "Sojitra", "Ambav", "Kanjari", "Zalod",
  "Gadhada", "Kuvarva", "Lilapur", "Chandisar", "Bhiladi", "Tharad", "Jasleni", "Sanadar",
  "Ratanpur", "Vadiya", "Amirgadh", "Danta", "Dhanpura", "Kotda", "Malana", "Rampura",
];

export const STREETS: readonly string[] = [
  "Shivnagar", "Ram Chowk", "Patel Vas", "Gandhi Road", "Station Road", "Temple Street",
  "Bus Stand Road", "Madhav Society", "Krishna Nagar", "Ashapura Society",
];
