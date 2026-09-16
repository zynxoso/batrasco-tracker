import { motion } from 'motion/react';
import { Building2, MapPin, Users, Zap } from 'lucide-react';
import batStateULogo from '@/assets/01e4d074c0b38b0f06f0e0063d950c77a6441659.png';
import batrascoLogo from '@/assets/a96689cbde93a70244783d9ffcc4e744ed153480.png';

export function CollaborationSplash() {
  return (
    <div className="min-h-dvh w-screen max-w-full bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-blue-500/20 to-transparent rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            rotate: [90, 0, 90],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-purple-500/20 to-transparent rounded-full blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 w-full h-full max-h-[95vh] relative z-10 flex flex-col justify-between"
      >
        {/* Main Title */}
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="text-center"
        >
          <div className="inline-block mb-4">
            <div className="flex items-center justify-center gap-3 mb-3">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center shadow-lg"
              >
                <MapPin className="w-6 h-6 text-white" />
              </motion.div>
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3">
            GPS-Based Vehicle Tracking System
          </h1>
          <p className="text-xl text-gray-600 font-medium mb-4">
            For Modern Jeepney Operations
          </p>
          <div className="flex items-center justify-center gap-6 text-gray-500">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium">Real-Time Tracking</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">Passenger Safety</span>
            </div>
          </div>
        </motion.div>

        {/* Collaboration Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.7 }}
          className="flex-1 flex flex-col justify-center"
        >
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-3">
              A Collaboration Between
            </h2>
            <div className="flex items-center justify-center gap-2">
              <div className="w-16 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent rounded-full"></div>
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <div className="w-16 h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent rounded-full"></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
            {/* Batangas State University - Real Logo */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.9, duration: 0.7 }}
              whileHover={{ scale: 1.03 }}
              className="relative"
            >
              <div className="bg-gradient-to-br from-red-50 via-white to-red-50 rounded-2xl p-8 border-2 border-red-200 shadow-xl hover:shadow-2xl transition-shadow h-full flex flex-col items-center justify-center">
                {/* University Logo - Real Image */}
                <div className="relative mb-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 1.1, type: "spring", stiffness: 150 }}
                    className="w-48 h-48 mx-auto flex items-center justify-center"
                  >
                    <img 
                      src={batStateULogo} 
                      alt="Batangas State University Logo" 
                      className="w-full h-full object-contain drop-shadow-xl"
                    />
                  </motion.div>
                  {/* Subtitle badge */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 1.3, type: "spring", stiffness: 200 }}
                    className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg whitespace-nowrap"
                  >
                    BATSTATE-U
                  </motion.div>
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 text-center mb-3">
                  Batangas State University
                </h3>
                <div className="bg-gradient-to-r from-red-600 to-red-700 text-white px-4 py-2 rounded-lg text-center mb-3 w-full">
                  <p className="text-sm font-bold">
                    The National Engineering University
                  </p>
                </div>
                <p className="text-sm text-gray-600 text-center font-medium">
                  Leading innovation in transportation technology
                </p>
              </div>
            </motion.div>

            {/* Batangas Transport Cooperative - Real Logo */}
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.9, duration: 0.7 }}
              whileHover={{ scale: 1.03 }}
              className="relative"
            >
              <div className="bg-gradient-to-br from-blue-50 via-white to-blue-50 rounded-2xl p-8 border-2 border-blue-200 shadow-xl hover:shadow-2xl transition-shadow h-full flex flex-col items-center justify-center">
                {/* Transport Cooperative Logo - Real Image */}
                <div className="relative mb-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 1.1, type: "spring", stiffness: 150 }}
                    className="w-48 h-48 mx-auto flex items-center justify-center"
                  >
                    <img 
                      src={batrascoLogo} 
                      alt="BATRASCO Logo" 
                      className="w-full h-full object-contain drop-shadow-xl"
                    />
                  </motion.div>
                  {/* Subtitle badge */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 1.3, type: "spring", stiffness: 200 }}
                    className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg"
                  >
                    BATRASCO
                  </motion.div>
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 text-center mb-3">
                  Batangas Transport Cooperative
                </h3>
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg text-center mb-3 w-full">
                  <p className="text-sm font-bold">
                    Modern Jeepney Transport Services
                  </p>
                </div>
                <p className="text-sm text-gray-600 text-center font-medium">
                  Committed to safe and efficient public transport
                </p>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Partnership Statement */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.7 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-50 to-purple-50 px-6 py-3 rounded-full border border-blue-200 mb-4">
            <Building2 className="w-5 h-5 text-blue-600" />
            <p className="text-sm font-semibold text-gray-700">
              Advancing Public Transportation Through Technology & Innovation
            </p>
          </div>

          {/* Loading Progress Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5, duration: 0.7 }}
          >
            <div className="text-center mb-2">
              <p className="text-xs text-gray-500 font-medium">Initializing System...</p>
            </div>
            <div className="w-full max-w-md mx-auto bg-gray-200 rounded-full h-2 overflow-hidden shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: 10, ease: 'linear' }}
                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full relative overflow-hidden"
              >
                <motion.div
                  animate={{ x: ['0%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-1/3"
                />
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}