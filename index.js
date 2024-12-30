require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

// Update CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// Update Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
    transports: ['websocket', 'polling']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const initialItems = [
  {
    id: 'neon-heart',
    name: 'Neon Heart',
    icon: '💗',
    position: { x: 200, y: 150 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'neon-star',
    name: 'Neon Star',
    icon: '⭐',
    position: { x: 400, y: 250 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'neon-bolt',
    name: 'Neon Lightning',
    icon: '⚡',
    position: { x: 600, y: 350 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'neon-crown',
    name: 'Neon Crown',
    icon: '👑',
    position: { x: 300, y: 400 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'diamond',
    name: 'Diamond',
    icon: '💎',
    position: { x: 150, y: 300 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'crystal-ball',
    name: 'Crystal Ball',
    icon: '🔮',
    position: { x: 500, y: 200 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'gem',
    name: 'Gem',
    icon: '💠',
    position: { x: 350, y: 400 },
    effect: 'glow',
    type: 'collectible'
  },
  {
    id: 'trophy',
    name: 'Trophy',
    icon: '🏆',
    position: { x: 250, y: 350 },
    effect: 'glow',
    type: 'collectible'
  }
];

const gameState = {
  users: new Map(),
  items: new Map(initialItems.map(item => [item.id, item]))
};

// Load items from database
async function loadItems() {
  try {
    const dbItems = await prisma.item.findMany();
    dbItems.forEach(item => {
      gameState.items.set(item.id, item);
    });
    console.log('Items loaded:', dbItems.length);
  } catch (error) {
    console.error('Error loading items:', error);
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Log items being sent
  const itemsToSend = Array.from(gameState.items.values());
  console.log('Sending initial items:', itemsToSend);
  
  // Send initial items immediately
  socket.emit('items:update', itemsToSend);

  socket.on('user:join', (userData) => {
    console.log('User joined:', userData);
    gameState.users.set(socket.id, userData);
    io.emit('users:update', Array.from(gameState.users.values()));
  });

  socket.on('user:move', (data) => {
    const user = gameState.users.get(data.userId);
    if (user) {
      user.position = data.position;
      gameState.users.set(data.userId, user);
      io.emit('users:update', Array.from(gameState.users.values()));
    }
  });

  socket.on('item:collect', async (data) => {
    const { itemId, userId } = data;
    const item = gameState.items.get(itemId);
    if (item) {
      gameState.items.delete(itemId);
      // Update the user's inventory
      const user = gameState.users.get(userId);
      if (user) {
        user.inventory.push(item);
        gameState.users.set(userId, user);
      }
      // Broadcast updates
      io.emit('items:update', Array.from(gameState.items.values()));
      io.emit('users:update', Array.from(gameState.users.values()));
    }
  });

  socket.on('item:pickup', ({ userId, itemId }) => {
    try {
      console.log('Processing item pickup:', { userId, itemId });
      
      const item = gameState.items.get(itemId);
      if (!item) {
        console.error('Item not found in world:', itemId);
        return;
      }

      const user = gameState.users.get(userId);
      if (!user) {
        console.error('User not found:', userId);
        return;
      }

      // Initialize inventory if it doesn't exist
      if (!user.inventory) {
        user.inventory = [];
      }

      // Add item to user's inventory - preserve all properties including id
      const itemForInventory = {
        id: item.id,          // Ensure ID is preserved
        name: item.name,
        icon: item.icon,
        type: item.type,
        effect: item.effect
      };
      
      user.inventory.push(itemForInventory);
      
      // Remove item from world
      gameState.items.delete(itemId);
      
      // Award XP
      if (!user.stats) {
        user.stats = { xp: 0, level: 1 };
      }
      user.stats.xp += 10;
      
      // Update user in gameState
      gameState.users.set(userId, user);
      
      console.log('Updated user inventory:', user.inventory);
      
      // Broadcast updates
      io.emit('items:update', Array.from(gameState.items.values()));
      io.emit('users:update', Array.from(gameState.users.values()));
    } catch (error) {
      console.error('Error processing item pickup:', error);
    }
  });

  socket.on('item:drop', ({ userId, itemId, position }) => {
    const user = gameState.users.get(userId);
    if (user) {
      const itemIndex = user.inventory.findIndex(item => item.id === itemId);
      if (itemIndex !== -1) {
        const item = user.inventory[itemIndex];
        // Remove from inventory
        user.inventory.splice(itemIndex, 1);
        // Add back to world at new position
        item.position = position;
        gameState.items.set(item.id, item);
        
        // Broadcast updates
        io.emit('items:update', Array.from(gameState.items.values()));
        io.emit('users:update', Array.from(gameState.users.values()));
      }
    }
  });

  socket.on('chat:message', (messageData) => {
    try {
      console.log('Server received message:', messageData);
      
      // Validate message data
      if (!messageData.userId || !messageData.message) {
        console.error('Invalid message data received');
        return;
      }

      // Ensure all required fields are present
      const message = {
        userId: messageData.userId,
        name: messageData.name || 'Unknown User',
        message: messageData.message,
        timestamp: messageData.timestamp || new Date().toISOString(),
        avatar: messageData.avatar
      };
      
      // Update the user's latest message in gameState
      const user = gameState.users.get(messageData.userId);
      if (user) {
        user.latestMessage = message;
        gameState.users.set(messageData.userId, user);
      }
      
      // Broadcast both the message and updated users
      io.emit('chat:message', message);
      io.emit('users:update', Array.from(gameState.users.values()));
      
      console.log('Server broadcasted message and updated users');
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    gameState.users.delete(socket.id);
    io.emit('users:update', Array.from(gameState.users.values()));
  });

  socket.on('user:update', (updatedUser) => {
    // Update the user in the users array
    users = users.map(user => 
      user.id === updatedUser.id ? updatedUser : user
    );
    
    // Broadcast the updated user immediately to all clients
    io.emit('users:update', users);
  });

  socket.on('item:use', ({ userId, itemId }) => {
    try {
      console.log('Server received item:use event:', { userId, itemId });
      
      const user = gameState.users.get(userId);
      if (!user) {
        console.error('User not found:', userId);
        return;
      }

      console.log('User inventory:', user.inventory);

      // Find the item in user's inventory
      const item = user.inventory.find(item => item.id === itemId);
      if (!item) {
        console.error('Item not found in user inventory:', itemId);
        console.log('Available items:', user.inventory.map(i => i.id));
        return;
      }

      // Set the active item
      user.activeItem = item;
      
      // Update user in gameState
      gameState.users.set(userId, user);
      
      // Broadcast the updated users to all clients
      const updatedUsers = Array.from(gameState.users.values());
      console.log('Broadcasting updated users with active item:', updatedUsers);
      io.emit('users:update', updatedUsers);
    } catch (error) {
      console.error('Error processing item use:', error);
    }
  });

  socket.on('item:unuse', ({ userId }) => {
    const user = gameState.users.get(userId);
    if (user) {
      // Remove active item
      user.activeItem = undefined;
      gameState.users.set(userId, user);
      
      // Broadcast update
      io.emit('users:update', Array.from(gameState.users.values()));
    }
  });
});

// Load items when server starts
loadItems().then(() => {
  const PORT = 3001;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});