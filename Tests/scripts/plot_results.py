import pandas as pd
import matplotlib.pyplot as plt

# Load the CSV data into pandas dataframe
latency_df = pd.read_csv('MQTT Scale (200).csv', parse_dates=['timestamp'])

# Extract device number from client_id (assuming SIMMACXXXX format for simulated devices)
latency_df['device_number'] = latency_df['client_id'].str.extract(r'SIMMAC(\w+)')[0].apply(lambda x: int(x[:2], 16) if pd.notnull(x) else None)

# Sort data by device number for a clearer graph
latency_df.sort_values('device_number', inplace=True)

# Plot latency for scaling from 1 to 100 devices
plt.figure(figsize=(12, 6))
plt.plot(range(1, len(latency_df) + 1), latency_df['latency_ms'], marker='o')

# Graph titles and labels
plt.title('MQTT Latency vs Number of Devices')
plt.xlabel('Device Number (1–200)')
plt.ylabel('Latency (ms)')
plt.grid(True)

# Add mean latency line for reference
mean_latency = latency_df['latency_ms'].mean()
plt.axhline(mean_latency, color='red', linestyle='--', linewidth=1, label=f'Mean Latency: {mean_latency:.2f} ms')

plt.legend()
plt.tight_layout()

# Save or show the plot
plt.savefig('mqtt_latency_scaling_plot.png', dpi=300)
plt.show()
