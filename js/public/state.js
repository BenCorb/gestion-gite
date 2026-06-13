export const state = {
  site: null,
  rooms: [],
  availability: null,
  roomPhotoIndexes: {},
  gitePhotoIndex: 0,
  lightboxPhotos: [],
  lightboxIndex: 0,
  filterState: "before",
  pendingRequest: null,
  availabilityCalendar: {
    monthDate: null,
    isOpen: false,
    selectionMode: "arrival",
  },
  requestCalendar: {
    roomId: null,
    monthDate: null,
    availabilityByDate: {},
    isLoading: false,
    isOpen: false,
    error: "",
    selectionMode: "arrival",
  },
};

export const loadedFontKeys = new Set();
