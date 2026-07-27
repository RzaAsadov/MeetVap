

adb -s A5PD6R5328005176 logcat -c
adb -s 9WVDU18B07002136 logcat -c

(
  adb -s A5PD6R5328005176 logcat -v threadtime > meetvap-A5PD6R5328005176.log &
  PID1=$!

  adb -s 9WVDU18B07002136 logcat -v threadtime > meetvap-9WVDU18B07002136.log &
  PID2=$!

  trap 'kill $PID1 $PID2 2>/dev/null' INT TERM EXIT
  wait
)
