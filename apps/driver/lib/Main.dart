import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_driver/config/env.dart';
import 'package:truxify_shared/truxify_shared.dart';

import 'app.dart';
import 'core/firebase_config.dart';
import 'providers/language_provider.dart';
import 'providers/network_provider.dart';
import 'providers/text_scale_provider.dart';
import 'services/background_sync_service.dart';

Future<void> main() async {
  // Ensure Flutter engine is initialized.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize crash reporting as early as possible.
  await CrashReportingService.init(appName: 'Driver');

  BackgroundSyncService.initialize();
  BackgroundSyncService.registerSyncTask();
  BackgroundSyncService.listenForConnectivity();

  // Validate required environment variables before app starts
  Env.validate();

  // Initialize Firebase
  try {
    if (kIsWeb) {
      if (!FirebaseConfig.isConfigured) {
        debugPrint(
          'Firebase credentials not provided via --dart-define. '
          'Skipping Firebase web initialization.',
        );
      } else {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: FirebaseConfig.apiKey,
            appId: FirebaseConfig.appId,
            messagingSenderId: FirebaseConfig.messagingSenderId,
            projectId: FirebaseConfig.projectId,
            storageBucket: FirebaseConfig.storageBucket,
            authDomain: FirebaseConfig.authDomain,
          ),
        );
      }
    } else {
      await Firebase.initializeApp();
    }
  } catch (e) {
    debugPrint('Firebase initialization failed: $e');
  }

  // Initialize Supabase using environment variables
  try {
    await Supabase.initialize(
      url: Env.supabaseUrl,
      anonKey: Env.supabaseAnonKey,
    );
  } catch (e) {
    debugPrint('Supabase initialization failed: $e');
  }

  // Replace Flutter's default red error screen in release/profile builds
  ErrorWidget.builder = TruxifyErrorWidget.builder;

  // Instantiate and pre-load required providers
  final languageProvider = LanguageProvider();
  await languageProvider.loadSavedLanguage();

  // Wrap runApp in a guarded zone to capture uncaught async errors
  runZonedGuarded(() {
    runApp(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<TextScaleProvider>(
            create: (_) => TextScaleProvider(),
          ),
          ChangeNotifierProvider<LanguageProvider>.value(
            value: languageProvider,
          ),
          ChangeNotifierProvider<NetworkProvider>(
            create: (_) => NetworkProvider(),
          ),
        ],
        child: TruxifyApp(languageProvider: languageProvider),
      ),
    );
  }, (error, stackTrace) {
    CrashReportingService.captureException(
      error,
      stackTrace: stackTrace,
      mechanism: 'runZonedGuarded',
    );
  });
}
