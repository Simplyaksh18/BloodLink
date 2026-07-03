import { create } from 'zustand';

export interface Message {
  id: string;
  text: string;
  sender: 'me' | 'them';
  time: string;
}

export interface Chat {
  id: string;
  name: string;
  role: string;
  bloodGroup: string;
  avatar: string;
  isOnline: boolean;
  unread: number;
  lastMessage?: string;
  time?: string;
  status: 'request' | 'responded' | 'saved';
}

interface ChatStore {
  chats: Chat[];
  messages: Record<string, Message[]>;
  createChat: (chat: Chat) => void;
  sendMessage: (chatId: string, text: string, sender: 'me' | 'them') => void;
  markAsRead: (chatId: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  messages: {},

  createChat: (chat) => {
    set((state) => {
      if (state.chats.some((c) => c.id === chat.id)) return state;
      return {
        chats: [chat, ...state.chats],
        messages: { ...state.messages, [chat.id]: [] },
      };
    });
  },

  sendMessage: (chatId, text, sender) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      text,
      sender,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const updatedChats = state.chats.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            lastMessage: text,
            time: newMessage.time,
            unread: sender === 'them' ? chat.unread + 1 : chat.unread,
            status: 'responded',
          };
        }
        return chat;
      });

      return {
        messages: { ...state.messages, [chatId]: [...chatMessages, newMessage] },
        chats: updatedChats,
      };
    });

    // Auto-responder logic for simulated user messaging
    if (sender === 'me') {
      setTimeout(() => {
        get().sendMessage(
          chatId,
          "Thank you for reaching out! Yes, we can coordinate the details. Are you available soon?",
          'them'
        );
      }, 1500);
    }
  },

  markAsRead: (chatId) => {
    set((state) => ({
      chats: state.chats.map((chat) => 
        chat.id === chatId ? { ...chat, unread: 0 } : chat
      ),
    }));
  },
}));
